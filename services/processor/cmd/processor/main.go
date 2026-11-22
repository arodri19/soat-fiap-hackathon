// Command processor é o worker que transforma vídeos em zips de frames.
//
// Consome video.requested do RabbitMQ, baixa o vídeo do S3/MinIO, extrai os
// frames com ffmpeg, grava o zip e publica video.processing/done/failed.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/archive"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/ffmpeg"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/messaging"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/observability"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/storage"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/config"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/usecase"
)

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

type uuidGenerator struct{}

func (uuidGenerator) NewID() string { return uuid.NewString() }

func main() {
	if err := run(); err != nil {
		slog.Error("processor encerrado com erro", "erro", err)
		os.Exit(1) // o orquestrador (compose/Kubernetes) reinicia o container
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := newLogger(cfg.LogLevel)
	slog.SetDefault(log)

	if err := os.MkdirAll(cfg.WorkDir, 0o750); err != nil {
		return err
	}

	store, err := storage.New(storage.Config{
		Endpoint: cfg.S3Endpoint, UseSSL: cfg.S3UseSSL, Region: cfg.S3Region,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey,
		RawBucket: cfg.RawBucket, ZipBucket: cfg.ZipBucket,
	})
	if err != nil {
		return err
	}

	conn, err := amqp.DialConfig(cfg.RabbitURL, amqp.Config{
		Heartbeat:  15 * time.Second,
		Properties: amqp.Table{"connection_name": "processor"},
	})
	if err != nil {
		return err
	}
	defer conn.Close() //nolint:errcheck

	publisher, err := messaging.NewPublisher(conn)
	if err != nil {
		return err
	}
	metrics := observability.NewMetrics()
	process := &usecase.ProcessVideo{
		Storage:   store,
		Extractor: ffmpeg.Extractor{FPS: cfg.FPS},
		Archiver:  archive.Zipper{},
		Publisher: publisher,
		Clock:     systemClock{},
		IDs:       uuidGenerator{},
		WorkDir:   cfg.WorkDir,
	}
	consumer, err := messaging.NewConsumer(conn, publisher, process, metrics, log, messaging.ConsumerConfig{
		Queue: cfg.Queue, Concurrency: cfg.Concurrency, MaxAttempts: cfg.MaxAttempts, JobTimeout: cfg.JobTimeout,
	})
	if err != nil {
		return err
	}

	server := observability.Server(cfg.MetricsAddr, metrics, map[string]observability.HealthCheck{
		"rabbitmq": func(context.Context) bool { return !conn.IsClosed() },
		"storage":  store.Healthy,
	})
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("servidor de métricas", "erro", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	done := make(chan error, 1)
	go func() { done <- consumer.Run(ctx) }()

	select {
	case err = <-done: // conexão perdida: sai com erro para o container reiniciar
	case <-ctx.Done():
		log.Info("encerrando: aguardando os vídeos em andamento", "limite", cfg.ShutdownTimeout)
		select {
		case err = <-done:
		case <-time.After(cfg.ShutdownTimeout):
			log.Warn("tempo de shutdown esgotado; mensagens não confirmadas voltam para a fila")
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	_ = consumer.Close()
	_ = publisher.Close()
	return err
}

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})).With("service", "processor")
}
