// Teste de integração do worker com infraestrutura real (Testcontainers):
// RabbitMQ com a topologia de infra/rabbitmq/definitions.json e MinIO.
package test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/archive"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/ffmpeg"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/messaging"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/observability"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/storage"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/usecase"
)

const (
	mainQueue = "processor.video-requested"
	dlqQueue  = "processor.video-requested.dlq"
)

type env struct {
	rabbitURL string
	s3        storage.Config
	minio     *minio.Client
	conn      *amqp.Connection
	ch        *amqp.Channel
	events    *eventLog
}

// eventLog guarda os eventos publicados pelo worker (fila de teste ligada à exchange).
type eventLog struct {
	mu   sync.Mutex
	list []amqp.Delivery
}

func (l *eventLog) forVideo(videoID string) []amqp.Delivery {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []amqp.Delivery
	for _, d := range l.list {
		if d.CorrelationId == videoID {
			out = append(out, d)
		}
	}
	return out
}

func (l *eventLog) waitFor(t *testing.T, videoID, routingKey string, timeout time.Duration) amqp.Delivery {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, d := range l.forVideo(videoID) {
			if d.RoutingKey == routingKey {
				return d
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("evento %s do vídeo %s não chegou em %s", routingKey, videoID, timeout)
	return amqp.Delivery{}
}

func setupEnv(t *testing.T) *env {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg não instalado")
	}
	ctx := context.Background()
	rabbitDir, err := filepath.Abs("../../../infra/rabbitmq")
	require.NoError(t, err)

	rabbit, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		Started: true,
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "rabbitmq:3.13-management-alpine",
			ExposedPorts: []string{"5672/tcp"},
			Files: []testcontainers.ContainerFile{
				{HostFilePath: rabbitDir + "/rabbitmq.conf", ContainerFilePath: "/etc/rabbitmq/conf.d/20-fiapx.conf", FileMode: 0o644},
				{HostFilePath: rabbitDir + "/definitions.json", ContainerFilePath: "/etc/rabbitmq/definitions.json", FileMode: 0o644},
			},
			WaitingFor: wait.ForLog("Server startup complete").WithStartupTimeout(2 * time.Minute),
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = rabbit.Terminate(context.Background()) })

	minioC, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		Started: true,
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "bitnamilegacy/minio:2025.4.22",
			ExposedPorts: []string{"9000/tcp"},
			Env: map[string]string{
				"MINIO_ROOT_USER": "minioadmin", "MINIO_ROOT_PASSWORD": "minioadmin",
				"MINIO_SKIP_CLIENT": "yes", // evita o restart da imagem Bitnami no boot
			},
			WaitingFor: wait.ForLog("API: http").WithStartupTimeout(time.Minute),
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = minioC.Terminate(context.Background()) })

	rabbitPort, err := rabbit.MappedPort(ctx, "5672")
	require.NoError(t, err)
	minioPort, err := minioC.MappedPort(ctx, "9000")
	require.NoError(t, err)

	e := &env{
		rabbitURL: fmt.Sprintf("amqp://fiapx:fiapx@127.0.0.1:%s/", rabbitPort.Port()),
		s3: storage.Config{
			Endpoint: "127.0.0.1:" + minioPort.Port(), Region: "us-east-1",
			AccessKey: "minioadmin", SecretKey: "minioadmin",
			RawBucket: "raw-videos", ZipBucket: "frame-zips",
		},
		events: &eventLog{},
	}
	e.minio, err = minio.New(e.s3.Endpoint, &minio.Options{Creds: credentials.NewStaticV4("minioadmin", "minioadmin", "")})
	require.NoError(t, err)
	for _, b := range []string{"raw-videos", "frame-zips"} {
		require.NoError(t, e.minio.MakeBucket(ctx, b, minio.MakeBucketOptions{}))
	}

	e.conn, err = amqp.Dial(e.rabbitURL)
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.conn.Close() })
	e.ch, err = e.conn.Channel()
	require.NoError(t, err)

	// Fila temporária que "escuta" os eventos publicados pelo worker
	q, err := e.ch.QueueDeclare("", false, true, true, false, nil)
	require.NoError(t, err)
	for _, key := range []string{"video.processing", "video.done", "video.failed"} {
		require.NoError(t, e.ch.QueueBind(q.Name, key, "videos", false, nil))
	}
	msgs, err := e.ch.Consume(q.Name, "", true, true, false, false, nil)
	require.NoError(t, err)
	go func() {
		for d := range msgs {
			e.events.mu.Lock()
			e.events.list = append(e.events.list, d)
			e.events.mu.Unlock()
		}
	}()
	return e
}

// startWorker sobe o worker completo (como no main) e devolve a função de parada.
func (e *env) startWorker(t *testing.T, s3cfg storage.Config, maxAttempts int) (stop func() error, metrics *observability.Metrics) {
	t.Helper()
	store, err := storage.New(s3cfg)
	require.NoError(t, err)
	conn, err := amqp.Dial(e.rabbitURL)
	require.NoError(t, err)
	publisher, err := messaging.NewPublisher(conn)
	require.NoError(t, err)
	metrics = observability.NewMetrics()
	process := &usecase.ProcessVideo{
		Storage: store, Extractor: ffmpeg.Extractor{}, Archiver: archive.Zipper{}, Publisher: publisher,
		Clock: clock{}, IDs: ids{}, WorkDir: t.TempDir(),
	}
	consumer, err := messaging.NewConsumer(conn, publisher, process, metrics,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		messaging.ConsumerConfig{Queue: mainQueue, Concurrency: 2, MaxAttempts: maxAttempts, JobTimeout: time.Minute})
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- consumer.Run(ctx) }()
	return func() error {
		cancel()
		select {
		case err := <-done:
			_ = conn.Close()
			return err
		case <-time.After(30 * time.Second):
			return fmt.Errorf("worker não encerrou")
		}
	}, metrics
}

type clock struct{}

func (clock) Now() time.Time { return time.Now() }

type ids struct{}

func (ids) NewID() string { return uuid.NewString() }

func (e *env) uploadVideo(t *testing.T, key string, content []byte) {
	t.Helper()
	_, err := e.minio.PutObject(context.Background(), "raw-videos", key, bytes.NewReader(content), int64(len(content)), minio.PutObjectOptions{})
	require.NoError(t, err)
}

func (e *env) request(t *testing.T, videoID, userID, filename, key string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"event_id": uuid.NewString(), "occurred_at": time.Now().UTC(), "video_id": videoID,
		"user_id": userID, "user_email": "ana@exemplo.com", "original_filename": filename, "storage_key": key,
	})
	require.NoError(t, e.ch.PublishWithContext(context.Background(), "videos", "video.requested", false, false, amqp.Publishing{
		ContentType: "application/json", DeliveryMode: amqp.Persistent, Body: body,
		Headers: amqp.Table{"x-request-id": "req-" + videoID[:8]},
	}))
}

func testVideo(t *testing.T, seconds int) []byte {
	t.Helper()
	path := filepath.Join(t.TempDir(), "v.mp4")
	out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
		"-i", "testsrc=size=160x120:rate=10", "-t", fmt.Sprint(seconds), "-pix_fmt", "yuv420p", "-y", path).CombinedOutput()
	require.NoError(t, err, string(out))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return data
}

func TestProcessorEndToEnd(t *testing.T) {
	e := setupEnv(t)
	ctx := context.Background()
	user := uuid.NewString()
	stop, metrics := e.startWorker(t, e.s3, 3)

	t.Run("vídeo válido vira zip com 1 frame por segundo", func(t *testing.T) {
		videoID := uuid.NewString()
		key := user + "/" + videoID + ".mp4"
		e.uploadVideo(t, key, testVideo(t, 4))

		e.request(t, videoID, user, "aula.mp4", key)

		processing := e.events.waitFor(t, videoID, "video.processing", 30*time.Second)
		done := e.events.waitFor(t, videoID, "video.done", 60*time.Second)
		assert.Equal(t, "req-"+videoID[:8], processing.Headers["x-request-id"], "rastreabilidade preservada")
		assert.Equal(t, uint8(amqp.Persistent), done.DeliveryMode)

		var payload struct {
			VideoID    string `json:"video_id"`
			ZipKey     string `json:"zip_key"`
			FrameCount int    `json:"frame_count"`
		}
		require.NoError(t, json.Unmarshal(done.Body, &payload))
		assert.Equal(t, videoID, payload.VideoID)
		assert.Equal(t, user+"/"+videoID+".zip", payload.ZipKey)
		assert.Equal(t, 4, payload.FrameCount)

		obj, err := e.minio.GetObject(ctx, "frame-zips", payload.ZipKey, minio.GetObjectOptions{})
		require.NoError(t, err)
		data, err := io.ReadAll(obj)
		require.NoError(t, err)
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		require.NoError(t, err)
		assert.Len(t, zr.File, 4)
		assert.Equal(t, "frame_0001.png", zr.File[0].Name)
	})

	t.Run("vários vídeos ao mesmo tempo", func(t *testing.T) {
		var videoIDs []string
		for i := 0; i < 4; i++ {
			id := uuid.NewString()
			key := user + "/" + id + ".mp4"
			e.uploadVideo(t, key, testVideo(t, 2))
			videoIDs = append(videoIDs, id)
		}
		for _, id := range videoIDs {
			e.request(t, id, user, "lote.mp4", user+"/"+id+".mp4")
		}
		for _, id := range videoIDs {
			e.events.waitFor(t, id, "video.done", 90*time.Second)
		}
	})

	t.Run("vídeo corrompido: video.failed na 1ª tentativa e mensagem original na DLQ", func(t *testing.T) {
		videoID := uuid.NewString()
		key := user + "/" + videoID + ".mkv"
		e.uploadVideo(t, key, []byte("isto não é um vídeo"))

		e.request(t, videoID, user, "corrompido.mkv", key)

		failed := e.events.waitFor(t, videoID, "video.failed", 30*time.Second)
		var payload struct {
			Error     string `json:"error"`
			Attempts  int    `json:"attempts"`
			UserEmail string `json:"user_email"`
		}
		require.NoError(t, json.Unmarshal(failed.Body, &payload))
		assert.Contains(t, payload.Error, "ffmpeg:")
		assert.Equal(t, 1, payload.Attempts, "erro definitivo não passa pelo retry")
		assert.Equal(t, "ana@exemplo.com", payload.UserEmail, "notification-service precisa do e-mail")

		dead := waitDLQ(t, e.ch, videoID)
		assert.Contains(t, dead.Headers["x-failure-reason"], "ffmpeg:")
	})

	require.NoError(t, stop(), "shutdown gracioso")
	body := scrape(t, metrics)
	assert.Contains(t, body, `videos_processed_total{result="done"} 5`) // 1 + lote de 4
	assert.Contains(t, body, `videos_processed_total{result="failed"} 1`)

	t.Run("falha transitória passa pela fila de retry até esgotar as tentativas", func(t *testing.T) {
		// Bucket de saída inexistente: o upload do zip falha a cada tentativa
		broken := e.s3
		broken.ZipBucket = "bucket-que-nao-existe"
		stopBroken, brokenMetrics := e.startWorker(t, broken, 2)
		defer func() { require.NoError(t, stopBroken()) }()

		videoID := uuid.NewString()
		key := user + "/" + videoID + ".mp4"
		e.uploadVideo(t, key, testVideo(t, 1))
		e.request(t, videoID, user, "retry.mp4", key)

		// 1ª tentativa falha → fila de retry (TTL 10 s) → 2ª tentativa falha → desiste
		failed := e.events.waitFor(t, videoID, "video.failed", 60*time.Second)
		var payload struct{ Attempts int }
		require.NoError(t, json.Unmarshal(failed.Body, &payload))
		assert.Equal(t, 2, payload.Attempts, "tentativa contada pelo header x-death")

		var attempts []int
		for _, d := range e.events.forVideo(videoID) {
			if d.RoutingKey == "video.processing" {
				var p struct{ Attempt int }
				_ = json.Unmarshal(d.Body, &p)
				attempts = append(attempts, p.Attempt)
			}
		}
		assert.Equal(t, []int{1, 2}, attempts)
		assert.Contains(t, scrape(t, brokenMetrics), `videos_processed_total{result="retry"} 1`)
		waitDLQ(t, e.ch, videoID)
	})
}

func waitDLQ(t *testing.T, ch *amqp.Channel, videoID string) amqp.Delivery {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		d, ok, err := ch.Get(dlqQueue, true)
		require.NoError(t, err)
		if ok {
			var body struct {
				VideoID string `json:"video_id"`
			}
			_ = json.Unmarshal(d.Body, &body)
			if body.VideoID == videoID {
				return d
			}
			continue
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("mensagem do vídeo %s não chegou na DLQ", videoID)
	return amqp.Delivery{}
}

func scrape(t *testing.T, m *observability.Metrics) string {
	t.Helper()
	srv := httptest.NewServer(observability.Server("", m, nil).Handler)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/metrics")
	require.NoError(t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return string(data)
}

func TestHealthEndpoint(t *testing.T) {
	m := observability.NewMetrics()
	healthy := httptest.NewServer(observability.Server("", m, map[string]observability.HealthCheck{
		"rabbitmq": func(context.Context) bool { return true },
		"storage":  func(context.Context) bool { return true },
	}).Handler)
	defer healthy.Close()
	res, err := http.Get(healthy.URL + "/health")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, res.StatusCode)
	_ = res.Body.Close()

	down := httptest.NewServer(observability.Server("", m, map[string]observability.HealthCheck{
		"rabbitmq": func(context.Context) bool { return false },
	}).Handler)
	defer down.Close()
	res, err = http.Get(down.URL + "/health")
	require.NoError(t, err)
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	_ = res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
	assert.Equal(t, "down", body["status"])
}
