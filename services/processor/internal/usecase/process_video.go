// Package usecase orquestra o processamento de um vídeo.
package usecase

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/port"
)

// ErrNoFrames indica que o ffmpeg rodou mas não gerou nenhum frame (vídeo vazio ou inválido).
var ErrNoFrames = errors.New("nenhum frame foi extraído do vídeo")

// ProcessVideo baixa o vídeo, extrai 1 frame por segundo, gera o zip, grava no
// storage e publica os eventos de status. É a versão desacoplada do
// processVideo/createZipFile do projeto base (legacy/main.go).
type ProcessVideo struct {
	Storage   port.Storage
	Extractor port.FrameExtractor
	Archiver  port.Archiver
	Publisher port.Publisher
	Clock     port.Clock
	IDs       port.IDGenerator
	// WorkDir é onde ficam os arquivos temporários de cada job (removidos no fim).
	WorkDir string
}

// Result resume um processamento bem-sucedido.
type Result struct {
	ZipKey     string
	FrameCount int
}

// Execute processa o job. attempt começa em 1. Erros definitivos vêm marcados
// com domain.Permanent; os demais podem ser tentados de novo.
func (uc *ProcessVideo) Execute(ctx context.Context, job domain.Job, attempt int) (Result, error) {
	if err := job.Validate(); err != nil {
		return Result{}, err
	}

	processing := domain.VideoProcessing{EventBase: uc.base(job), Attempt: attempt}
	if err := uc.publish(ctx, job, domain.RoutingKeyProcessing, processing.EventID, processing); err != nil {
		return Result{}, fmt.Errorf("publicar video.processing: %w", err)
	}

	dir, err := os.MkdirTemp(uc.WorkDir, "job-"+job.VideoID+"-")
	if err != nil {
		return Result{}, fmt.Errorf("criar diretório temporário: %w", err)
	}
	defer os.RemoveAll(dir) //nolint:errcheck // limpeza best-effort

	videoPath := filepath.Join(dir, "input"+filepath.Ext(job.StorageKey))
	if err := uc.Storage.DownloadVideo(ctx, job.StorageKey, videoPath); err != nil {
		return Result{}, fmt.Errorf("baixar vídeo: %w", err)
	}

	framesDir := filepath.Join(dir, "frames")
	if err := os.Mkdir(framesDir, 0o750); err != nil {
		return Result{}, fmt.Errorf("criar diretório de frames: %w", err)
	}
	frames, err := uc.Extractor.Extract(ctx, videoPath, framesDir)
	if err != nil {
		return Result{}, err
	}
	if len(frames) == 0 {
		return Result{}, domain.Permanent(ErrNoFrames)
	}

	zipPath := filepath.Join(dir, "frames.zip")
	if err := uc.Archiver.Zip(frames, zipPath); err != nil {
		return Result{}, fmt.Errorf("gerar zip: %w", err)
	}

	zipKey := job.ZipKey()
	if err := uc.Storage.UploadZip(ctx, zipKey, zipPath); err != nil {
		return Result{}, fmt.Errorf("gravar zip: %w", err)
	}

	done := domain.VideoDone{EventBase: uc.base(job), ZipKey: zipKey, FrameCount: len(frames)}
	if err := uc.publish(ctx, job, domain.RoutingKeyDone, done.EventID, done); err != nil {
		// O zip já está salvo: numa nova tentativa ele é regravado e o evento sai de novo.
		return Result{}, fmt.Errorf("publicar video.done: %w", err)
	}
	return Result{ZipKey: zipKey, FrameCount: len(frames)}, nil
}

// Fail publica video.failed (consumido pela video-api e pelo notification-service).
func (uc *ProcessVideo) Fail(ctx context.Context, job domain.Job, cause error, attempts int) error {
	failed := domain.VideoFailed{
		EventBase:        uc.base(job),
		UserID:           job.UserID,
		UserEmail:        job.UserEmail,
		OriginalFilename: job.OriginalFilename,
		Error:            domain.UserMessage(cause),
		Attempts:         attempts,
	}
	return uc.publish(ctx, job, domain.RoutingKeyFailed, failed.EventID, failed)
}

func (uc *ProcessVideo) base(job domain.Job) domain.EventBase {
	return domain.EventBase{EventID: uc.IDs.NewID(), OccurredAt: uc.Clock.Now().UTC(), VideoID: job.VideoID}
}

func (uc *ProcessVideo) publish(ctx context.Context, job domain.Job, routingKey, eventID string, body any) error {
	headers := map[string]string{}
	if job.RequestID != "" {
		headers["x-request-id"] = job.RequestID
	}
	return uc.Publisher.Publish(ctx, port.Message{
		RoutingKey:    routingKey,
		MessageID:     eventID,
		CorrelationID: job.VideoID,
		Body:          body,
		Headers:       headers,
	})
}
