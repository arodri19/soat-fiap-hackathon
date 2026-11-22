// Package config lê a configuração das variáveis de ambiente.
package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	RabbitURL       string
	Queue           string
	Concurrency     int
	MaxAttempts     int
	JobTimeout      time.Duration
	ShutdownTimeout time.Duration

	S3Endpoint  string // host:porta
	S3UseSSL    bool
	S3Region    string
	S3AccessKey string
	S3SecretKey string
	RawBucket   string
	ZipBucket   string

	FPS         string
	WorkDir     string
	MetricsAddr string
	LogLevel    string
}

// Load lê o ambiente; variáveis obrigatórias ausentes ou inválidas viram um único erro.
func Load() (Config, error) {
	var errs []string
	str := func(key, def string, required bool) string {
		v := strings.TrimSpace(os.Getenv(key))
		if v == "" {
			if required {
				errs = append(errs, key+" é obrigatória")
			}
			return def
		}
		return v
	}
	num := func(key string, def int) int {
		v := os.Getenv(key)
		if v == "" {
			return def
		}
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			errs = append(errs, key+" deve ser um inteiro positivo")
			return def
		}
		return n
	}
	dur := func(key string, def time.Duration) time.Duration {
		v := os.Getenv(key)
		if v == "" {
			return def
		}
		d, err := time.ParseDuration(v)
		if err != nil || d <= 0 {
			errs = append(errs, key+" deve ser uma duração (ex.: 10m)")
			return def
		}
		return d
	}

	cfg := Config{
		RabbitURL:       str("RABBITMQ_URL", "", true),
		Queue:           str("QUEUE", "processor.video-requested", false),
		Concurrency:     num("WORKER_CONCURRENCY", 2),
		MaxAttempts:     num("MAX_ATTEMPTS", 3),
		JobTimeout:      dur("JOB_TIMEOUT", 10*time.Minute),
		ShutdownTimeout: dur("SHUTDOWN_TIMEOUT", 2*time.Minute),
		S3Region:        str("S3_REGION", "us-east-1", false),
		S3AccessKey:     str("S3_ACCESS_KEY", "", true),
		S3SecretKey:     str("S3_SECRET_KEY", "", true),
		RawBucket:       str("S3_BUCKET_RAW", "raw-videos", false),
		ZipBucket:       str("S3_BUCKET_ZIP", "frame-zips", false),
		FPS:             str("FFMPEG_FPS", "1", false),
		WorkDir:         str("WORK_DIR", os.TempDir(), false),
		MetricsAddr:     str("METRICS_ADDR", ":9101", false),
		LogLevel:        str("LOG_LEVEL", "info", false),
	}

	// S3_ENDPOINT aceita URL completa (http://minio:9000), como nos serviços Node
	if raw := str("S3_ENDPOINT", "", true); raw != "" {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			errs = append(errs, "S3_ENDPOINT deve ser uma URL (ex.: http://minio:9000)")
		} else {
			cfg.S3Endpoint, cfg.S3UseSSL = u.Host, u.Scheme == "https"
		}
	}

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("configuração inválida:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return cfg, nil
}
