// Package port define as interfaces que o caso de uso usa. As implementações
// ficam em internal/adapter (MinIO, ffmpeg, zip, RabbitMQ).
package port

import (
	"context"
	"time"
)

// Storage lê o vídeo e grava o zip no S3/MinIO.
type Storage interface {
	DownloadVideo(ctx context.Context, key, destPath string) error
	UploadZip(ctx context.Context, key, srcPath string) error
}

// FrameExtractor extrai os frames do vídeo para dir e devolve os arquivos gerados, em ordem.
type FrameExtractor interface {
	Extract(ctx context.Context, videoPath, dir string) ([]string, error)
}

// Archiver compacta os arquivos em um zip.
type Archiver interface {
	Zip(files []string, destPath string) error
}

// Message é um evento a publicar na exchange "videos".
type Message struct {
	RoutingKey    string
	MessageID     string
	CorrelationID string
	Body          any
	Headers       map[string]string
}

// Publisher publica eventos e só retorna depois da confirmação do broker.
type Publisher interface {
	Publish(ctx context.Context, msg Message) error
}

// Clock e IDGenerator existem para os testes serem determinísticos.
type Clock interface{ Now() time.Time }

type IDGenerator interface{ NewID() string }
