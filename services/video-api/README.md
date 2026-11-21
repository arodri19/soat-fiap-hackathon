# video-api

> Ainda não implementado — previsto na **Fase 2**.

Recebe o upload, grava no storage S3, registra o vídeo como `PENDING` e enfileira o processamento via outbox transacional. Lista os vídeos do usuário com status, gera URL de download e consome os eventos de status do worker.

| | |
|---|---|
| Linguagem | Node 20 + NestJS (TypeScript) |
| Porta | 3002 |
| Depende de | `video_db` (PostgreSQL), Redis, MinIO (S3), RabbitMQ |
| Contrato | [contracts/openapi/videos.yaml](../../contracts/openapi/videos.yaml) e [contracts/asyncapi.yaml](../../contracts/asyncapi.yaml) |
