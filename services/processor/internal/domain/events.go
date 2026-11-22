package domain

import "time"

// Routing keys publicadas pelo worker na exchange "videos" (contracts/asyncapi.yaml).
const (
	Exchange             = "videos"
	RoutingKeyRequested  = "video.requested"
	RoutingKeyProcessing = "video.processing"
	RoutingKeyDone       = "video.done"
	RoutingKeyFailed     = "video.failed"
	// DeadLetterExchange recebe a mensagem original quando o processamento desiste.
	DeadLetterExchange = "videos.dlq"
)

// EventBase são os campos comuns a todos os eventos.
type EventBase struct {
	EventID    string    `json:"event_id"`
	OccurredAt time.Time `json:"occurred_at"`
	VideoID    string    `json:"video_id"`
}

// VideoProcessing é publicado quando o worker começa a processar.
type VideoProcessing struct {
	EventBase
	Attempt int `json:"attempt"`
}

// VideoDone é publicado quando o zip foi gravado no storage.
type VideoDone struct {
	EventBase
	ZipKey     string `json:"zip_key"`
	FrameCount int    `json:"frame_count"`
}

// VideoFailed é publicado quando o processamento falha de forma definitiva.
type VideoFailed struct {
	EventBase
	UserID           string `json:"user_id"`
	UserEmail        string `json:"user_email"`
	OriginalFilename string `json:"original_filename"`
	Error            string `json:"error"`
	Attempts         int    `json:"attempts"`
}
