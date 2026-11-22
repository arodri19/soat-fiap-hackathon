package usecase_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/port"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/usecase"
)

// ---------- dublês ----------

type fakeStorage struct {
	videos      map[string]string // chave → conteúdo
	zips        map[string][]byte
	downloadErr error
	uploadErr   error
}

func (s *fakeStorage) DownloadVideo(_ context.Context, key, dest string) error {
	if s.downloadErr != nil {
		return s.downloadErr
	}
	content, ok := s.videos[key]
	if !ok {
		return domain.Permanent(fmt.Errorf("vídeo não encontrado (%s)", key))
	}
	return os.WriteFile(dest, []byte(content), 0o600)
}

func (s *fakeStorage) UploadZip(_ context.Context, key, src string) error {
	if s.uploadErr != nil {
		return s.uploadErr
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	s.zips[key] = data
	return nil
}

type fakeExtractor struct {
	frames int
	err    error
	gotDir string
}

func (e *fakeExtractor) Extract(_ context.Context, videoPath, dir string) ([]string, error) {
	e.gotDir = dir
	if e.err != nil {
		return nil, e.err
	}
	if _, err := os.Stat(videoPath); err != nil {
		return nil, fmt.Errorf("vídeo não baixado: %w", err)
	}
	var files []string
	for i := 1; i <= e.frames; i++ {
		path := filepath.Join(dir, fmt.Sprintf("frame_%04d.png", i))
		if err := os.WriteFile(path, []byte("png"), 0o600); err != nil {
			return nil, err
		}
		files = append(files, path)
	}
	return files, nil
}

type fakeArchiver struct{ files []string }

func (a *fakeArchiver) Zip(files []string, dest string) error {
	a.files = files
	return os.WriteFile(dest, []byte(fmt.Sprintf("zip com %d frames", len(files))), 0o600)
}

type fakePublisher struct {
	messages []port.Message
	failOn   string
}

func (p *fakePublisher) Publish(_ context.Context, m port.Message) error {
	if m.RoutingKey == p.failOn {
		return errors.New("broker indisponível")
	}
	p.messages = append(p.messages, m)
	return nil
}

func (p *fakePublisher) keys() []string {
	var ks []string
	for _, m := range p.messages {
		ks = append(ks, m.RoutingKey)
	}
	return ks
}

type fixedClock struct{}

func (fixedClock) Now() time.Time { return time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC) }

type seqIDs struct{ n int }

func (s *seqIDs) NewID() string { s.n++; return fmt.Sprintf("evt-%d", s.n) }

// ---------- cenário ----------

type deps struct {
	storage   *fakeStorage
	extractor *fakeExtractor
	archiver  *fakeArchiver
	publisher *fakePublisher
	uc        *usecase.ProcessVideo
}

func setup(t *testing.T) deps {
	t.Helper()
	d := deps{
		storage:   &fakeStorage{videos: map[string]string{"u1/v1.mp4": "video"}, zips: map[string][]byte{}},
		extractor: &fakeExtractor{frames: 3},
		archiver:  &fakeArchiver{},
		publisher: &fakePublisher{},
	}
	d.uc = &usecase.ProcessVideo{
		Storage: d.storage, Extractor: d.extractor, Archiver: d.archiver, Publisher: d.publisher,
		Clock: fixedClock{}, IDs: &seqIDs{}, WorkDir: t.TempDir(),
	}
	return d
}

func job() domain.Job {
	return domain.Job{
		EventID: "req-1", VideoID: "v1", UserID: "u1", UserEmail: "ana@exemplo.com",
		OriginalFilename: "aula.mp4", StorageKey: "u1/v1.mp4", RequestID: "rid-42",
	}
}

func TestExecuteSuccess(t *testing.T) {
	d := setup(t)

	res, err := d.uc.Execute(context.Background(), job(), 1)

	require.NoError(t, err)
	assert.Equal(t, usecase.Result{ZipKey: "u1/v1.zip", FrameCount: 3}, res)
	assert.Equal(t, []byte("zip com 3 frames"), d.storage.zips["u1/v1.zip"])
	assert.Len(t, d.archiver.files, 3)

	require.Equal(t, []string{domain.RoutingKeyProcessing, domain.RoutingKeyDone}, d.publisher.keys())
	processing, done := d.publisher.messages[0], d.publisher.messages[1]
	assert.Equal(t, "v1", processing.CorrelationID)
	assert.Equal(t, map[string]string{"x-request-id": "rid-42"}, processing.Headers)
	assert.Equal(t, domain.VideoProcessing{
		EventBase: domain.EventBase{EventID: "evt-1", OccurredAt: fixedClock{}.Now(), VideoID: "v1"},
		Attempt:   1,
	}, processing.Body)
	assert.Equal(t, "evt-1", processing.MessageID)
	assert.Equal(t, domain.VideoDone{
		EventBase:  domain.EventBase{EventID: "evt-2", OccurredAt: fixedClock{}.Now(), VideoID: "v1"},
		ZipKey:     "u1/v1.zip",
		FrameCount: 3,
	}, done.Body)

	_, statErr := os.Stat(filepath.Dir(d.extractor.gotDir))
	assert.True(t, os.IsNotExist(statErr), "diretório temporário do job deve ser removido")
}

func TestExecuteInvalidVideoIsPermanent(t *testing.T) {
	d := setup(t)
	d.extractor.err = domain.Permanent(errors.New("ffmpeg: Invalid data found when processing input"))

	_, err := d.uc.Execute(context.Background(), job(), 1)

	require.Error(t, err)
	assert.True(t, domain.IsPermanent(err))
	assert.Empty(t, d.storage.zips)
	assert.Equal(t, []string{domain.RoutingKeyProcessing}, d.publisher.keys(), "sem video.done")
}

func TestExecuteNoFramesIsPermanent(t *testing.T) {
	d := setup(t)
	d.extractor.frames = 0

	_, err := d.uc.Execute(context.Background(), job(), 1)

	assert.ErrorIs(t, err, usecase.ErrNoFrames)
	assert.True(t, domain.IsPermanent(err))
}

func TestExecuteTransientErrorsCanBeRetried(t *testing.T) {
	cases := map[string]func(*deps){
		"download":           func(d *deps) { d.storage.downloadErr = errors.New("connection reset") },
		"upload":             func(d *deps) { d.storage.uploadErr = errors.New("timeout") },
		"publish processing": func(d *deps) { d.publisher.failOn = domain.RoutingKeyProcessing },
		"publish done":       func(d *deps) { d.publisher.failOn = domain.RoutingKeyDone },
	}
	for name, breakIt := range cases {
		t.Run(name, func(t *testing.T) {
			d := setup(t)
			breakIt(&d)

			_, err := d.uc.Execute(context.Background(), job(), 1)

			require.Error(t, err)
			assert.False(t, domain.IsPermanent(err), "falha de infraestrutura deve ter retry")
		})
	}
}

func TestExecuteMissingVideoIsPermanent(t *testing.T) {
	d := setup(t)
	j := job()
	j.StorageKey = "u1/inexistente.mp4"

	_, err := d.uc.Execute(context.Background(), j, 1)

	assert.True(t, domain.IsPermanent(err))
}

func TestExecuteRejectsInvalidJob(t *testing.T) {
	d := setup(t)
	j := job()
	j.UserEmail = ""

	_, err := d.uc.Execute(context.Background(), j, 1)

	assert.True(t, domain.IsPermanent(err))
	assert.Empty(t, d.publisher.messages, "nada é publicado para mensagem inválida")
}

func TestFailPublishesVideoFailed(t *testing.T) {
	d := setup(t)

	err := d.uc.Fail(context.Background(), job(), errors.New("ffmpeg: arquivo corrompido"), 3)

	require.NoError(t, err)
	require.Len(t, d.publisher.messages, 1)
	msg := d.publisher.messages[0]
	assert.Equal(t, domain.RoutingKeyFailed, msg.RoutingKey)
	assert.Equal(t, domain.VideoFailed{
		EventBase:        domain.EventBase{EventID: "evt-1", OccurredAt: fixedClock{}.Now(), VideoID: "v1"},
		UserID:           "u1",
		UserEmail:        "ana@exemplo.com",
		OriginalFilename: "aula.mp4",
		Error:            "ffmpeg: arquivo corrompido",
		Attempts:         3,
	}, msg.Body)
}
