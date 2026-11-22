package archive_test

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/arodri19/soat-fiap-hackathon/services/processor/internal/adapter/archive"
)

func TestZipStoresFilesAtRootWithDeflate(t *testing.T) {
	dir := t.TempDir()
	var files []string
	for i, content := range []string{"primeiro", "segundo"} {
		path := filepath.Join(dir, "frames", []string{"frame_0001.png", "frame_0002.png"}[i])
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
		files = append(files, path)
	}
	dest := filepath.Join(dir, "out.zip")

	require.NoError(t, archive.Zipper{}.Zip(files, dest))

	r, err := zip.OpenReader(dest)
	require.NoError(t, err)
	defer r.Close()
	require.Len(t, r.File, 2)
	assert.Equal(t, "frame_0001.png", r.File[0].Name, "sem o caminho do diretório temporário")
	assert.Equal(t, zip.Deflate, r.File[0].Method)
	rc, err := r.File[1].Open()
	require.NoError(t, err)
	content, _ := io.ReadAll(rc)
	_ = rc.Close()
	assert.Equal(t, "segundo", string(content))
}

func TestZipFailsWhenFrameIsMissing(t *testing.T) {
	dir := t.TempDir()
	err := archive.Zipper{}.Zip([]string{filepath.Join(dir, "nao-existe.png")}, filepath.Join(dir, "out.zip"))
	assert.Error(t, err)
}
