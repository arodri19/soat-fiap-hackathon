// Package domain contém os tipos e regras do processamento de vídeo, sem
// dependência de RabbitMQ, S3 ou ffmpeg.
package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Job é a mensagem video.requested publicada pela video-api (contracts/asyncapi.yaml).
type Job struct {
	EventID          string    `json:"event_id"`
	OccurredAt       time.Time `json:"occurred_at"`
	VideoID          string    `json:"video_id"`
	UserID           string    `json:"user_id"`
	UserEmail        string    `json:"user_email"`
	OriginalFilename string    `json:"original_filename"`
	StorageKey       string    `json:"storage_key"`
	// RequestID vem do header x-request-id e acompanha os eventos (rastreabilidade).
	RequestID string `json:"-"`
}

// Validate garante que a mensagem segue o contrato antes de processar.
func (j Job) Validate() error {
	var missing []string
	for name, value := range map[string]string{
		"event_id":          j.EventID,
		"video_id":          j.VideoID,
		"user_id":           j.UserID,
		"user_email":        j.UserEmail,
		"original_filename": j.OriginalFilename,
		"storage_key":       j.StorageKey,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return Permanent(fmt.Errorf("mensagem inválida, campos ausentes: %s", strings.Join(missing, ", ")))
	}
	return nil
}

// ZipKey é a chave do zip no bucket de frames: <user_id>/<video_id>.zip.
func (j Job) ZipKey() string {
	return j.UserID + "/" + j.VideoID + ".zip"
}

// PermanentError indica uma falha que não melhora com nova tentativa
// (vídeo corrompido, formato inválido, mensagem fora do contrato).
type PermanentError struct{ Err error }

func (e *PermanentError) Error() string { return e.Err.Error() }
func (e *PermanentError) Unwrap() error { return e.Err }

// Permanent marca o erro como definitivo: o vídeo vai direto para FAILED, sem retry.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return &PermanentError{Err: err}
}

// IsPermanent informa se o erro (ou algum erro encadeado) é definitivo.
func IsPermanent(err error) bool {
	var p *PermanentError
	return errors.As(err, &p)
}

// Decision é o que fazer com a mensagem depois de uma falha.
type Decision int

const (
	// Retry devolve a mensagem para a fila de retry (backoff de 10 s pelo TTL).
	Retry Decision = iota
	// GiveUp publica video.failed e manda a mensagem original para a DLQ.
	GiveUp
)

// DecideOnFailure aplica a política de retry: erro definitivo ou tentativas esgotadas → GiveUp.
func DecideOnFailure(err error, attempt, maxAttempts int) Decision {
	if IsPermanent(err) || attempt >= maxAttempts {
		return GiveUp
	}
	return Retry
}

// UserMessage transforma o erro técnico na mensagem guardada no vídeo e enviada por e-mail.
func UserMessage(err error) string {
	msg := strings.TrimSpace(err.Error())
	if len(msg) > 500 {
		msg = msg[:500] + "…"
	}
	return msg
}
