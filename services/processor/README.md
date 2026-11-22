# processor-worker

Worker que transforma vídeos em zips de frames: consome `video.requested`, baixa o vídeo do S3/MinIO, extrai 1 frame por segundo com ffmpeg, grava o zip e publica `video.processing`, `video.done` e `video.failed`. Contrato: [asyncapi.yaml](../../contracts/asyncapi.yaml).

| | |
|---|---|
| Stack | Go 1.27, ffmpeg, `amqp091-go`, `minio-go` |
| Porta | 9101 (`/metrics`, `/health`; interna) |
| Banco | Nenhum: o status é atualizado pela video-api a partir dos eventos |
| Imagem | ~150 MB (Alpine, binário estático, usuário não-root) |

A lógica de extração e zip vem do projeto base ([legacy/main.go](../../legacy/main.go)), agora desacoplada em portas e adaptadores.

## Concorrência e escala

- Cada réplica processa `WORKER_CONCURRENCY` vídeos ao mesmo tempo (goroutines), com `prefetch` igual a esse número no RabbitMQ.
- Para escalar horizontalmente, basta subir mais réplicas: `make scale n=3`. Todas consomem a mesma fila, e o RabbitMQ distribui as mensagens entre elas.
- O Prometheus descobre as réplicas automaticamente pelo DNS do compose.

## Confiabilidade

| Situação | Comportamento |
|---|---|
| Worker cai no meio de um vídeo | Sem `ack`, o RabbitMQ entrega a mensagem para outra réplica |
| Falha transitória (storage ou broker fora) | `nack` → fila de retry (10 s) → nova tentativa. A tentativa atual é calculada pelo header `x-death` |
| Vídeo corrompido ou formato inválido | Erro definitivo: `video.failed` na hora, sem retry |
| Tentativas esgotadas (`MAX_ATTEMPTS`, padrão 3) | `video.failed` e a mensagem original vai para `processor.video-requested.dlq`, com `x-failure-reason` |
| ffmpeg travado | Timeout por vídeo (`JOB_TIMEOUT`, padrão 10 min) |
| Deploy ou `SIGTERM` | Para de receber mensagens novas e termina os vídeos em andamento (`SHUTDOWN_TIMEOUT`) |
| Perdeu a conexão com o RabbitMQ | Encerra com erro e o compose/Kubernetes reinicia (*crash-only*) |
| Mensagem duplicada | Idempotente: o zip é sobrescrito e a video-api ignora transições repetidas |

Todos os eventos são persistentes e publicados com *publisher confirms*. O `x-request-id` do upload acompanha os eventos.

## Arquitetura

```
cmd/processor/          bootstrap, configuração, graceful shutdown
internal/domain/        Job, eventos, erro definitivo × transitório, política de retry
internal/usecase/       ProcessVideo: download → ffmpeg → zip → upload → eventos
internal/port/          interfaces (Storage, FrameExtractor, Archiver, Publisher)
internal/adapter/       ffmpeg, zip, MinIO/S3, RabbitMQ (consumer + publisher), métricas
test/                   E2E com RabbitMQ (definitions.json real) e MinIO via Testcontainers
```

## Testes e lint (sem precisar de Go instalado)

```bash
make processor-test   # unitários + E2E (gera vídeos reais com ffmpeg), em container
make processor-lint   # golangci-lint v2 + govulncheck
```

Com Go 1.27 e ffmpeg instalados: `go test -race -cover ./...`.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `RABBITMQ_URL` | — | Obrigatória |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Obrigatórias (`http://minio:9000`) |
| `S3_BUCKET_RAW` / `S3_BUCKET_ZIP` | `raw-videos` / `frame-zips` | Buckets de entrada e saída |
| `WORKER_CONCURRENCY` | `2` | Vídeos em paralelo por réplica |
| `MAX_ATTEMPTS` | `3` | Tentativas antes de `FAILED` |
| `JOB_TIMEOUT` | `10m` | Limite por vídeo |
| `SHUTDOWN_TIMEOUT` | `2m` | Espera pelos vídeos em andamento no shutdown |
| `FFMPEG_FPS` | `1` | Frames extraídos por segundo |
| `METRICS_ADDR` | `:9101` | Endereço de `/metrics` e `/health` |
