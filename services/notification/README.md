# notification-service

> Ainda não implementado — previsto na **Fase 4**.

Consome `video.failed` e envia e-mail ao usuário (Mailpit no ambiente local).

| | |
|---|---|
| Linguagem | Node 20 + NestJS (TypeScript) |
| Porta | 3003 |
| Depende de | RabbitMQ e SMTP — sem banco próprio |
| Contrato | [contracts/asyncapi.yaml](../../contracts/asyncapi.yaml) |
