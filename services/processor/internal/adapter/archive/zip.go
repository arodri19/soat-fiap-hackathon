// Package archive gera o zip com os frames (createZipFile do projeto base).
package archive

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Zipper grava os arquivos na raiz do zip, com compressão Deflate.
type Zipper struct{}

func (Zipper) Zip(files []string, destPath string) (err error) {
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := out.Close(); err == nil {
			err = cerr
		}
	}()

	zw := zip.NewWriter(out)
	for _, file := range files {
		if err := addFile(zw, file); err != nil {
			return fmt.Errorf("adicionar %s ao zip: %w", filepath.Base(file), err)
		}
	}
	return zw.Close()
}

func addFile(zw *zip.Writer, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close() //nolint:errcheck // somente leitura

	info, err := f.Stat()
	if err != nil {
		return err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = filepath.Base(path) // sem diretórios: só o nome do frame
	header.Method = zip.Deflate

	w, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}
