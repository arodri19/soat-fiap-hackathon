// Package messaging conecta o worker ao RabbitMQ (amqp091-go).
package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/port"
)

// Publisher publica em modo confirm: só retorna depois do ack do broker.
type Publisher struct {
	ch *amqp.Channel
	mu sync.Mutex
}

func NewPublisher(conn *amqp.Connection) (*Publisher, error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, fmt.Errorf("abrir canal de publicação: %w", err)
	}
	if err := ch.Confirm(false); err != nil {
		return nil, fmt.Errorf("ativar publisher confirms: %w", err)
	}
	return &Publisher{ch: ch}, nil
}

// Publish publica um evento JSON na exchange "videos".
func (p *Publisher) Publish(ctx context.Context, msg port.Message) error {
	body, err := json.Marshal(msg.Body)
	if err != nil {
		return fmt.Errorf("serializar %s: %w", msg.RoutingKey, err)
	}
	return p.publishRaw(ctx, domain.Exchange, msg.RoutingKey, amqp.Publishing{
		ContentType:   "application/json",
		DeliveryMode:  amqp.Persistent,
		MessageId:     msg.MessageID,
		CorrelationId: msg.CorrelationID,
		Timestamp:     time.Now(),
		Headers:       toTable(msg.Headers),
		Body:          body,
	})
}

// publishRaw publica e espera a confirmação (com timeout, para não travar o worker).
func (p *Publisher) publishRaw(ctx context.Context, exchange, routingKey string, msg amqp.Publishing) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	p.mu.Lock()
	confirm, err := p.ch.PublishWithDeferredConfirmWithContext(ctx, exchange, routingKey, false, false, msg)
	p.mu.Unlock()
	if err != nil {
		return fmt.Errorf("publicar %s: %w", routingKey, err)
	}
	acked, err := confirm.WaitContext(ctx)
	if err != nil {
		return fmt.Errorf("confirmação de %s: %w", routingKey, err)
	}
	if !acked {
		return errors.New("broker recusou a mensagem " + routingKey)
	}
	return nil
}

func (p *Publisher) Close() error { return p.ch.Close() }

func toTable(headers map[string]string) amqp.Table {
	if len(headers) == 0 {
		return nil
	}
	t := amqp.Table{}
	for k, v := range headers {
		t[k] = v
	}
	return t
}
