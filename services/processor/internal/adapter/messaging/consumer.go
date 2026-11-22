package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/observability"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/usecase"
)

// ConsumerConfig controla concorrência, retry e timeout.
type ConsumerConfig struct {
	Queue       string        // processor.video-requested
	Concurrency int           // vídeos processados ao mesmo tempo por réplica
	MaxAttempts int           // tentativas antes de desistir (FAILED + DLQ)
	JobTimeout  time.Duration // limite por vídeo (ffmpeg travado não prende o worker)
}

// Consumer lê video.requested e processa com N goroutines.
//
// Garantias (contracts/asyncapi.yaml):
//   - ack manual, só depois do processamento concluído (nada se perde se o worker cair);
//   - erro transitório → nack sem requeue → fila de retry (TTL 10 s) → volta para a fila;
//   - erro definitivo ou tentativas esgotadas → video.failed + mensagem original na DLQ.
type Consumer struct {
	cfg       ConsumerConfig
	ch        *amqp.Channel
	publisher *Publisher
	process   *usecase.ProcessVideo
	metrics   *observability.Metrics
	log       *slog.Logger
	tag       string
}

func NewConsumer(
	conn *amqp.Connection,
	publisher *Publisher,
	process *usecase.ProcessVideo,
	metrics *observability.Metrics,
	log *slog.Logger,
	cfg ConsumerConfig,
) (*Consumer, error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, fmt.Errorf("abrir canal de consumo: %w", err)
	}
	// prefetch = concorrência: o broker entrega no máximo N vídeos por vez para esta réplica
	if err := ch.Qos(cfg.Concurrency, 0, false); err != nil {
		return nil, fmt.Errorf("configurar prefetch: %w", err)
	}
	return &Consumer{
		cfg: cfg, ch: ch, publisher: publisher, process: process,
		metrics: metrics, log: log, tag: "processor-" + uuid.NewString()[:8],
	}, nil
}

// Run consome até ctx ser cancelado (shutdown) ou o canal fechar (conexão perdida).
func (c *Consumer) Run(ctx context.Context) error {
	deliveries, err := c.ch.ConsumeWithContext(ctx, c.cfg.Queue, c.tag, false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consumir %s: %w", c.cfg.Queue, err)
	}
	c.log.Info("consumindo", "fila", c.cfg.Queue, "concorrencia", c.cfg.Concurrency)

	var workers sync.WaitGroup
	for i := 0; i < c.cfg.Concurrency; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for d := range deliveries {
				c.handle(d)
			}
		}()
	}
	// deliveries fecha quando o consumo é cancelado (shutdown) ou a conexão cai;
	// os vídeos já em andamento terminam antes de Run retornar.
	workers.Wait()

	select {
	case <-ctx.Done():
		return nil // shutdown pedido
	default:
		return errors.New("canal do RabbitMQ fechado")
	}
}

func (c *Consumer) handle(d amqp.Delivery) {
	var job domain.Job
	if err := json.Unmarshal(d.Body, &job); err != nil {
		c.deadLetter(d, "JSON inválido: "+err.Error())
		return
	}
	if rid, ok := d.Headers["x-request-id"].(string); ok {
		job.RequestID = rid
	}
	attempt := Attempt(d.Headers, c.cfg.Queue)
	log := c.log.With("video_id", job.VideoID, "tentativa", attempt, "request_id", job.RequestID)

	// O processamento usa um contexto próprio: o shutdown deixa o vídeo atual terminar.
	ctx, cancel := context.WithTimeout(context.Background(), c.cfg.JobTimeout)
	defer cancel()

	c.metrics.InProgress.Inc()
	start := time.Now()
	result, err := c.process.Execute(ctx, job, attempt)
	c.metrics.InProgress.Dec()
	c.metrics.Duration.Observe(time.Since(start).Seconds())

	if err == nil {
		c.metrics.Processed.WithLabelValues("done").Inc()
		c.metrics.Frames.Add(float64(result.FrameCount))
		log.Info("vídeo processado", "frames", result.FrameCount, "duracao", time.Since(start).Round(time.Millisecond))
		c.ack(d)
		return
	}

	switch domain.DecideOnFailure(err, attempt, c.cfg.MaxAttempts) {
	case domain.Retry:
		log.Warn("falha transitória, nova tentativa em instantes", "erro", err)
		c.metrics.Processed.WithLabelValues("retry").Inc()
		c.nack(d) // vai para a fila de retry pelo dead-letter-exchange
	case domain.GiveUp:
		log.Error("processamento falhou", "erro", err, "definitivo", domain.IsPermanent(err))
		if ferr := c.process.Fail(ctx, job, err, attempt); ferr != nil {
			log.Error("não foi possível publicar video.failed; tentará de novo", "erro", ferr)
			c.nack(d)
			return
		}
		c.metrics.Processed.WithLabelValues("failed").Inc()
		c.deadLetter(d, err.Error())
	}
}

// deadLetter guarda a mensagem original na DLQ (para análise) e confirma o consumo.
func (c *Consumer) deadLetter(d amqp.Delivery, reason string) {
	headers := amqp.Table{}
	for k, v := range d.Headers {
		headers[k] = v
	}
	headers["x-failure-reason"] = domain.UserMessage(errors.New(reason))
	err := c.publisher.publishRaw(context.Background(), domain.DeadLetterExchange, domain.RoutingKeyRequested, amqp.Publishing{
		ContentType:   d.ContentType,
		DeliveryMode:  amqp.Persistent,
		MessageId:     d.MessageId,
		CorrelationId: d.CorrelationId,
		Timestamp:     time.Now(),
		Headers:       headers,
		Body:          d.Body,
	})
	if err != nil {
		c.log.Error("falha ao enviar para a DLQ; mensagem volta para retry", "erro", err)
		c.nack(d)
		return
	}
	c.metrics.Processed.WithLabelValues("dead_letter").Inc()
	c.ack(d)
}

func (c *Consumer) ack(d amqp.Delivery) {
	if err := d.Ack(false); err != nil {
		c.log.Error("ack falhou (a mensagem será reentregue)", "erro", err)
	}
}

func (c *Consumer) nack(d amqp.Delivery) {
	if err := d.Nack(false, false); err != nil {
		c.log.Error("nack falhou (a mensagem será reentregue)", "erro", err)
	}
}

func (c *Consumer) Close() error { return c.ch.Close() }

// Attempt calcula a tentativa atual pelo header x-death: cada rejeição na fila
// principal soma 1 (a mensagem passa pela fila de retry e volta).
func Attempt(headers amqp.Table, queue string) int {
	deaths, ok := headers["x-death"].([]any)
	if !ok {
		return 1
	}
	for _, raw := range deaths {
		death, ok := raw.(amqp.Table)
		if !ok {
			continue
		}
		if death["queue"] == queue && death["reason"] == "rejected" {
			switch n := death["count"].(type) {
			case int64:
				return int(n) + 1
			case int32:
				return int(n) + 1
			case int:
				return n + 1
			}
		}
	}
	return 1
}
