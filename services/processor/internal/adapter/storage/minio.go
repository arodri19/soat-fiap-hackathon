// Package storage implementa o acesso ao S3/MinIO.
package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
)

// Config do cliente S3. Funciona com MinIO, AWS S3 ou outro compatível.
type Config struct {
	Endpoint  string // host:porta, sem esquema (ex.: minio:9000)
	UseSSL    bool
	Region    string
	AccessKey string
	SecretKey string
	RawBucket string
	ZipBucket string
}

// S3 lê os vídeos do bucket de entrada e grava os zips no bucket de saída.
type S3 struct {
	client *minio.Client
	cfg    Config
}

func New(cfg Config) (*S3, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("cliente S3: %w", err)
	}
	return &S3{client: client, cfg: cfg}, nil
}

// DownloadVideo grava o objeto em disco. Objeto inexistente é erro definitivo.
func (s *S3) DownloadVideo(ctx context.Context, key, destPath string) error {
	err := s.client.FGetObject(ctx, s.cfg.RawBucket, key, destPath, minio.GetObjectOptions{})
	if err == nil {
		return nil
	}
	var resp minio.ErrorResponse
	if errors.As(err, &resp) && resp.Code == "NoSuchKey" {
		return domain.Permanent(fmt.Errorf("vídeo não encontrado no storage (%s)", key))
	}
	return err
}

// UploadZip grava (ou sobrescreve) o zip; regravar o mesmo vídeo é idempotente.
func (s *S3) UploadZip(ctx context.Context, key, srcPath string) error {
	_, err := s.client.FPutObject(ctx, s.cfg.ZipBucket, key, srcPath, minio.PutObjectOptions{
		ContentType: "application/zip",
	})
	return err
}

// Healthy verifica se o bucket de entrada está acessível.
func (s *S3) Healthy(ctx context.Context) bool {
	ok, err := s.client.BucketExists(ctx, s.cfg.RawBucket)
	return err == nil && ok
}
