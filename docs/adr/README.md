# Architecture Decision Records

Registro das decisões de arquitetura: o contexto, a escolha, as alternativas e as consequências.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-monorepo.md) | Monorepo com serviços independentes | Aceita |
| [0002](0002-nestjs-nas-apis-e-go-no-worker.md) | NestJS nas APIs e Go só no worker | Aceita |
| [0003](0003-banco-por-servico-e-status-por-eventos.md) | Banco por serviço; status por eventos | Aceita |
| [0004](0004-transactional-outbox.md) | Transactional outbox | Aceita |
| [0005](0005-rabbitmq.md) | RabbitMQ em vez de Kafka | Aceita |
| [0006](0006-armazenamento-s3.md) | Arquivos em S3/MinIO com URL pré-assinada | Aceita |
| [0007](0007-jwt-rs256-e-refresh-em-cookie.md) | JWT RS256 + refresh token rotativo em cookie | Aceita |
| [0008](0008-sql-puro-em-vez-de-orm.md) | `pg` + SQL puro em vez de Prisma | Aceita |
