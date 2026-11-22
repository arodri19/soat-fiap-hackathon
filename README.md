# FIAP X — Processador de Vídeos

Hackathon **SOAT — Fase 5 (FIAP Pós Tech)**. O usuário envia vídeos e baixa um `.zip` com os frames extraídos.

Esta versão reescreve o [projeto base](legacy/) com arquitetura de microsserviços e mensageria. A versão nova processa vários vídeos ao mesmo tempo, não perde requisições em picos, exige usuário e senha, lista o status dos vídeos de cada usuário e avisa por e-mail quando um processamento falha.

## Arquitetura

```mermaid
flowchart LR
    U[Navegador<br/>Vue 3 + Vuetify] --> GW[Gateway nginx]
    GW -->|/api/auth| AUTH[auth-service<br/>NestJS]
    GW -->|/api/videos| API[video-api<br/>NestJS]
    AUTH --> PGA[(Postgres<br/>auth_db)]
    AUTH --> R[(Redis)]
    API -. JWKS .-> AUTH
    API --> PGV[(Postgres<br/>video_db)]
    API --> S3[(MinIO / S3)]
    API -->|video.requested| MQ{{RabbitMQ}}
    MQ --> W[processor-worker × N<br/>Go + ffmpeg]
    W --> S3
    W -->|processing / done / failed| MQ
    MQ -->|status| API
    MQ -->|video.failed| N[notification-service<br/>NestJS]
    N --> MAIL[E-mail]
```

| Serviço | Pasta | Stack | Status |
|---|---|---|---|
| auth-service | [services/auth](services/auth) | Node + NestJS | ✅ Implementado |
| video-api | [services/video-api](services/video-api) | Node + NestJS | ✅ Implementado |
| processor-worker | [services/processor](services/processor) | Go + ffmpeg | Planejado |
| notification-service | [services/notification](services/notification) | Node + NestJS | Planejado |
| frontend | `frontend/` | Vue 3 + Vuetify | Planejado |

**Decisões principais**
- **Banco por serviço.** O worker não acessa banco: ele publica eventos de status e a video-api atualiza o próprio banco.
- **Outbox transacional + filas quorum + ack manual + retry/DLQ.** Nenhum upload aceito fica sem processamento.
- **JWT RS256.** Os serviços validam o token localmente pela chave pública (JWKS), sem chamar o auth a cada requisição.
- **Monorepo com serviços independentes.** Cada um tem `package.json`/`go.mod`, Dockerfile e pipeline próprios e nenhum importa código de outro, então podem virar repositórios separados sem retrabalho.

## Estrutura

```
services/        microsserviços (um projeto independente por pasta)
frontend/        SPA
contracts/       OpenAPI (HTTP) e AsyncAPI (mensagens): fonte única dos contratos
infra/
  db/            criação dos databases por serviço + schema.sql de referência
  rabbitmq/      exchanges, filas, DLQ e retry (definitions.json)
  minio/         criação dos buckets
  gateway/       roteamento /api/*
  monitoring/    Prometheus e Grafana
legacy/          projeto base original, mantido como referência
.github/         CI (por serviço, com check consolidado ci-ok) e CD (GHCR)
```

## Como rodar

Pré-requisitos: Docker com Compose v2 e `make`.

```bash
cp .env.example .env    # opcional: os valores padrão já funcionam
make up                 # gera a chave do JWT, builda os serviços e sobe tudo (buckets, filas e databases incluídos)
make ps                 # status
make down               # derruba (mantém os dados); make clean apaga os volumes
make help               # todos os comandos
```

| Componente | URL local | Acesso |
|---|---|---|
| Gateway (aplicação) | http://localhost:8080 | API em `/api/auth/*` e `/api/videos/*` |
| RabbitMQ | http://localhost:15672 | `fiapx` / `fiapx` |
| MinIO (console) | http://localhost:9001 | `minioadmin` / `minioadmin` |
| Mailpit (e-mails) | http://localhost:8025 | — |
| Grafana | http://localhost:3000 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | — |
| PostgreSQL | `localhost:5432` | `auth_user`/`auth_pass` em `auth_db`, `video_user`/`video_pass` em `video_db` |
| Redis | `localhost:6379` | — |

> As credenciais acima valem apenas para o ambiente local.

## Contratos

- [contracts/openapi/auth.yaml](contracts/openapi/auth.yaml): cadastro, login, refresh, logout, JWKS
- [contracts/openapi/videos.yaml](contracts/openapi/videos.yaml): upload, listagem de status, download
- [contracts/asyncapi.yaml](contracts/asyncapi.yaml): eventos `video.requested`, `video.processing`, `video.done`, `video.failed`

Para validar: `make lint-contracts`.

## Fluxo de desenvolvimento

`main` ⇒ `homologacao` ⇒ `feat/*`. Toda branch nasce de `homologacao` e volta para ela por PR; `homologacao` vai para `main` por PR. Não há push direto em `main` nem em `homologacao`.

- **CI:** roda lint, testes, cobertura e build apenas dos serviços alterados. O check `ci-ok` consolida o resultado e é obrigatório para o merge.
- **CD:** a cada merge, publica as imagens alteradas em `ghcr.io/<owner>/fiapx-<serviço>`, com a tag `:homolog` ou `:latest` conforme a branch.
