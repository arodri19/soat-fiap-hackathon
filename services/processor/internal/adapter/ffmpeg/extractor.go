// Package ffmpeg extrai frames de vídeo chamando o binário ffmpeg.
package ffmpeg

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
)

// Extractor extrai frames a uma taxa fixa (padrão 1 por segundo, como no projeto base).
type Extractor struct {
	Binary string // padrão: "ffmpeg"
	FPS    string // padrão: "1"
}

// Extract roda: ffmpeg -i <video> -vf fps=1 <dir>/frame_%04d.png
//
// Falha do ffmpeg com o vídeo (arquivo corrompido, formato inválido) é erro
// definitivo: tentar de novo não muda o resultado. Cancelamento/timeout do
// contexto não é marcado como definitivo.
func (e Extractor) Extract(ctx context.Context, videoPath, dir string) ([]string, error) {
	bin, fps := e.Binary, e.FPS
	if bin == "" {
		bin = "ffmpeg"
	}
	if fps == "" {
		fps = "1"
	}

	pattern := filepath.Join(dir, "frame_%04d.png")
	cmd := exec.CommandContext(ctx, bin,
		"-hide_banner", "-loglevel", "error", "-nostdin",
		"-i", videoPath,
		"-vf", "fps="+fps,
		"-y", pattern,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("ffmpeg interrompido: %w", ctx.Err())
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil, domain.Permanent(fmt.Errorf("ffmpeg: %s", summarize(stderr.String())))
		}
		return nil, fmt.Errorf("executar ffmpeg: %w", err) // binário ausente etc.
	}

	frames, err := filepath.Glob(filepath.Join(dir, "frame_*.png"))
	if err != nil {
		return nil, fmt.Errorf("listar frames: %w", err)
	}
	sort.Strings(frames)
	return frames, nil
}

// summarize devolve a última linha relevante do stderr do ffmpeg (a causa).
func summarize(stderr string) string {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			// remove o caminho do arquivo temporário do início ("/tmp/.../input.mp4: ...")
			if idx := strings.Index(line, ": "); idx > 0 && strings.HasPrefix(line, "/") {
				line = line[idx+2:]
			}
			return line
		}
	}
	return "falha ao processar o vídeo"
}
