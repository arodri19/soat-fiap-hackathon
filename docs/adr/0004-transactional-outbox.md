# 0004 — Transactional outbox para não perder uploads

- **Status:** aceita (2026-11-21)

## Contexto
Requisito do PDF: "em caso de picos, o sistema não deve perder uma requisição". No upload, a video-api precisa gravar o vídeo no banco **e** publicar `video.requested`. Se fizer as duas coisas separadamente, uma queda entre elas deixa um vídeo `PENDING` para sempre (sem mensagem) ou uma mensagem sem vídeo (sem commit).

## Decisão
- Gravar o vídeo e a mensagem na tabela `outbox` **na mesma transação**.
- Um *relay* na própria video-api lê a outbox (`FOR UPDATE SKIP LOCKED`, a cada 500 ms), publica com *publisher confirms* e marca `published_at`.
- A resposta `202` só sai depois do commit. Se o RabbitMQ estiver fora, o upload continua aceito e a mensagem espera na outbox.

## Alternativas
- **Publicar direto e torcer:** perde mensagem quando o broker ou o processo falha.
- **Transação distribuída (2PC):** complexa e pouco suportada pelo RabbitMQ.
- **CDC (Debezium):** robusto, mas pesado demais para o escopo.

## Consequências
- Entrega *at-least-once*: o relay pode publicar de novo após uma falha. Por isso os consumidores são idempotentes ([0003](0003-banco-por-servico-e-status-por-eventos.md)).
- `SKIP LOCKED` permite várias réplicas da video-api sem publicar a mesma mensagem ao mesmo tempo.
- A métrica `outbox_pending` aparece no dashboard e cresce se o broker cair.
