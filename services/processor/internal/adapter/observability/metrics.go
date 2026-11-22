// Package observability expõe métricas Prometheus e o health check.
package observability

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics do worker (rótulo service="processor" vem do Prometheus/compose).
type Metrics struct {
	Registry   *prometheus.Registry
	Processed  *prometheus.CounterVec // done | retry | failed | dead_letter
	Duration   prometheus.Histogram
	Frames     prometheus.Counter
	InProgress prometheus.Gauge
}

func NewMetrics() *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	m := &Metrics{
		Registry: reg,
		Processed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "videos_processed_total",
			Help: "Vídeos processados por resultado",
		}, []string{"result"}),
		Duration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "video_processing_duration_seconds",
			Help:    "Tempo de processamento de um vídeo (download + ffmpeg + zip + upload)",
			Buckets: []float64{1, 2, 5, 10, 30, 60, 120, 300, 600},
		}),
		Frames: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "video_frames_extracted_total",
			Help: "Frames extraídos",
		}),
		InProgress: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "videos_in_progress",
			Help: "Vídeos sendo processados agora nesta réplica",
		}),
	}
	reg.MustRegister(m.Processed, m.Duration, m.Frames, m.InProgress)
	return m
}

// HealthCheck é uma verificação nomeada (ex.: "rabbitmq", "storage").
type HealthCheck func(ctx context.Context) bool

// Server expõe /metrics e /health.
func Server(addr string, m *Metrics, checks map[string]HealthCheck) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.HandlerFor(m.Registry, promhttp.HandlerOpts{}))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		result := map[string]bool{}
		ok := true
		for name, check := range checks {
			result[name] = check(ctx)
			ok = ok && result[name]
		}
		status := "ok"
		w.Header().Set("Content-Type", "application/json")
		if !ok {
			status = "down"
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "checks": result})
	})
	return &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
}
