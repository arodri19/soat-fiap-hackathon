package ffmpeg_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/ffmpeg"
	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
)

// MakeTestVideo gera um vídeo sintético (padrão de teste do ffmpeg) com a duração pedida.
func MakeTestVideo(t *testing.T, dir string, seconds int) string {
	t.Helper()
	path := filepath.Join(dir, "teste.mp4")
	out, err := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=size=160x120:rate=10",
		"-t", itoa(seconds), "-pix_fmt", "yuv420p", "-y", path).CombinedOutput()
	require.NoError(t, err, string(out))
	return path
}

func itoa(n int) string { return string(rune('0' + n)) }

func requireFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg não instalado")
	}
}

func TestExtractOneFramePerSecond(t *testing.T) {
	requireFFmpeg(t)
	dir := t.TempDir()
	video := MakeTestVideo(t, dir, 3)
	framesDir := filepath.Join(dir, "frames")
	require.NoError(t, os.Mkdir(framesDir, 0o750))

	frames, err := ffmpeg.Extractor{}.Extract(context.Background(), video, framesDir)

	require.NoError(t, err)
	assert.Len(t, frames, 3)
	assert.Equal(t, "frame_0001.png", filepath.Base(frames[0]))
	assert.Equal(t, "frame_0003.png", filepath.Base(frames[2]))
}

func TestExtractCorruptedVideoIsPermanent(t *testing.T) {
	requireFFmpeg(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "corrompido.mp4")
	require.NoError(t, os.WriteFile(bad, []byte("isto não é um vídeo"), 0o600))

	_, err := ffmpeg.Extractor{}.Extract(context.Background(), bad, dir)

	require.Error(t, err)
	assert.True(t, domain.IsPermanent(err))
	assert.Contains(t, err.Error(), "ffmpeg: ")
	assert.NotContains(t, err.Error(), dir, "a mensagem não expõe o caminho temporário")
}

func TestExtractTimeoutIsNotPermanent(t *testing.T) {
	requireFFmpeg(t)
	dir := t.TempDir()
	video := MakeTestVideo(t, dir, 3)
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	time.Sleep(time.Millisecond)

	_, err := ffmpeg.Extractor{}.Extract(ctx, video, dir)

	require.Error(t, err)
	assert.False(t, domain.IsPermanent(err), "timeout pode dar certo em outra tentativa")
}

func TestExtractMissingBinary(t *testing.T) {
	_, err := ffmpeg.Extractor{Binary: "ffmpeg-que-nao-existe"}.Extract(context.Background(), "x.mp4", t.TempDir())
	require.Error(t, err)
	assert.False(t, domain.IsPermanent(err))
}
