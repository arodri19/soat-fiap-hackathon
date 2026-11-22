package domain_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/domain"
)

func validJob() domain.Job {
	return domain.Job{
		EventID: "e1", VideoID: "v1", UserID: "u1", UserEmail: "ana@exemplo.com",
		OriginalFilename: "aula.mp4", StorageKey: "u1/v1.mp4",
	}
}

func TestJobValidate(t *testing.T) {
	require.NoError(t, validJob().Validate())

	job := validJob()
	job.VideoID, job.StorageKey = "", "  "
	err := job.Validate()
	require.Error(t, err)
	assert.True(t, domain.IsPermanent(err), "mensagem fora do contrato não deve ser tentada de novo")
	assert.Contains(t, err.Error(), "video_id")
	assert.Contains(t, err.Error(), "storage_key")
}

func TestZipKey(t *testing.T) {
	assert.Equal(t, "u1/v1.zip", validJob().ZipKey())
}

func TestPermanentWrapping(t *testing.T) {
	base := errors.New("arquivo corrompido")
	wrapped := fmt.Errorf("processar: %w", domain.Permanent(base))

	assert.True(t, domain.IsPermanent(wrapped), "encadeado com %%w continua definitivo")
	assert.ErrorIs(t, wrapped, base)
	assert.False(t, domain.IsPermanent(base))
	assert.NoError(t, domain.Permanent(nil))
}

func TestDecideOnFailure(t *testing.T) {
	transient := errors.New("storage indisponível")
	permanent := domain.Permanent(errors.New("vídeo inválido"))

	assert.Equal(t, domain.Retry, domain.DecideOnFailure(transient, 1, 3))
	assert.Equal(t, domain.Retry, domain.DecideOnFailure(transient, 2, 3))
	assert.Equal(t, domain.GiveUp, domain.DecideOnFailure(transient, 3, 3), "tentativas esgotadas")
	assert.Equal(t, domain.GiveUp, domain.DecideOnFailure(permanent, 1, 3), "definitivo não tem retry")
}

func TestUserMessage(t *testing.T) {
	assert.Equal(t, "ffmpeg: Invalid data", domain.UserMessage(errors.New("  ffmpeg: Invalid data \n")))
	long := domain.UserMessage(errors.New(strings.Repeat("x", 600)))
	assert.LessOrEqual(t, len([]rune(long)), 501)
	assert.True(t, strings.HasSuffix(long, "…"))
}
