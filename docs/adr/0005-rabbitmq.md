# 0005 — RabbitMQ em vez de Kafka

- **Status:** aceita (2026-11-21)

## Contexto
É preciso uma fila de trabalho (cada vídeo processado por um único worker) com retry, DLQ e entrega garantida, além de eventos de status consumidos por mais de um serviço.

## Decisão
RabbitMQ 3.13, com:
- exchange `videos` (topic) e uma fila por consumidor;
- filas **quorum** duráveis, mensagens persistentes, *publisher confirms* e ack manual;
- retry com espera por fila de TTL de 10 s (sem `sleep` no worker), contando as tentativas pelo header `x-death`;
- DLQ por consumidor;
- topologia versionada em `infra/rabbitmq/definitions.json`, carregada no boot.

## Alternativas
- **Kafka:** ótimo para streams e replay, mas o modelo de partições complica a fila de trabalho (paralelismo limitado ao número de partições, sem retry/DLQ nativos) e a operação é mais pesada para o escopo.
- **Redis Streams / SQS:** viáveis, mas o RabbitMQ é o recomendado no PDF e tem painel de gerenciamento útil para a demonstração.

## Consequências
- `prefetch` igual à concorrência distribui os vídeos entre réplicas conforme a capacidade de cada uma.
- O painel do RabbitMQ e as métricas por fila mostram o backlog durante o teste de carga.
