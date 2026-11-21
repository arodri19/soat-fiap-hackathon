# processor-worker

> Ainda não implementado — previsto na **Fase 3**.

Consome `video.requested`, baixa o vídeo, extrai os frames com ffmpeg (1 fps), gera o zip, grava no storage e publica `video.processing` / `video.done` / `video.failed`. Processa vários vídeos em paralelo (goroutines) e escala horizontalmente pela fila. Reaproveita a lógica de [legacy/main.go](../../legacy/main.go).

| | |
|---|---|
| Linguagem | Go |
| Porta | 9101 (métricas) |
| Depende de | MinIO (S3) e RabbitMQ — sem banco próprio |
| Contrato | [contracts/asyncapi.yaml](../../contracts/asyncapi.yaml) |
