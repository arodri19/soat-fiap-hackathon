# Roteiro da apresentação (vídeo de até 10 min)

O PDF pede que o vídeo mostre **documentação, arquitetura escolhida e o projeto funcionando**.

## Antes de gravar

```bash
make clean && make up          # ambiente limpo (aguarde todos os serviços "healthy")
make scale n=3                 # 3 réplicas do worker
```

Deixe abertas as abas:
1. **Aplicação:** http://localhost:8080
2. **Grafana:** http://localhost:3000 (dashboard "FIAP X — Visão geral", últimos 15 min, refresh de 5 s)
3. **RabbitMQ:** http://localhost:15672 (`fiapx` / `fiapx`), aba *Queues*
4. **Mailpit:** http://localhost:8025
5. **GitHub:** o repositório, na aba *Actions*, e um PR mergeado mostrando os checks
6. **Editor:** `docs/arquitetura.md` aberto no preview de Markdown, para os diagramas aparecerem

Prepare dois arquivos: um vídeo curto real, como `tests/fixtures/sample-5s.mp4`, e um "vídeo" inválido (um `.mp4` que é texto).

## Roteiro

| Tempo | Parte | O que mostrar e falar |
|---|---|---|
| 0:00–0:45 | **Problema** | O projeto base: processava dentro da requisição HTTP, usava disco local, não tinha login, fila nem testes e tinha path traversal no download. Os requisitos do PDF (tabela da seção 1 de `docs/arquitetura.md`) |
| 0:45–3:00 | **Arquitetura** | Diagrama de containers (§2.2): gateway, 4 microsserviços, banco por serviço, RabbitMQ, MinIO. Por que **Go só no worker** e NestJS no resto (ADR 0002). Sequência do upload (§4.2): `202` imediato, **outbox**, fila, worker, eventos de status |
| 3:00–4:00 | **Não perder requisição** | Outbox, filas quorum, confirms, ack manual, retry de 10 s, DLQ (§5 e ADR 0004). Fluxo de falha (§4.3): o mesmo `video.failed` vai para o status e para o e-mail |
| 4:00–7:30 | **Demo** | Ver o passo a passo abaixo |
| 7:30–8:45 | **Qualidade e CI/CD** | Actions: um job por serviço (só o que mudou) e o **E2E do sistema** que sobe a stack inteira; o `ci-ok` obrigatório; branches `main` ⇒ `homologacao` ⇒ `feat/*` protegidas. Pirâmide de testes: unitários, Testcontainers, E2E e carga |
| 8:45–9:30 | **Documentação** | `docs/arquitetura.md`, ADRs, contratos OpenAPI/AsyncAPI, scripts de banco (`infra/db`, `migrations/`) |
| 9:30–10:00 | **Fechamento** | O que cada requisito virou; próximos passos (Kubernetes + KEDA, SSE) |

## Demo (≈ 3,5 min)

1. **Cadastro e login** (aplicação): criar conta com uma senha fraca primeiro, para mostrar a validação, e depois com uma senha válida. Comentar que o token fica só em memória e que recarregar a página mantém a sessão (cookie HttpOnly).
2. **Upload de vários vídeos:** arrastar 3 a 4 vídeos de uma vez. Mostrar a barra de progresso e os cards "Na fila → Processando → Concluído" mudando sozinhos.
3. **Download:** clicar em "Baixar zip" e abrir o zip para mostrar os frames `frame_0001.png…`.
4. **Erro e notificação:** enviar o arquivo inválido. Ele vira "Erro" com a mensagem do ffmpeg, aparece o aviso na tela e, no **Mailpit**, o e-mail "Falha ao processar o vídeo…".
5. **Pico sem perda** (Grafana ao lado):
   ```bash
   make load VIDEOS=200 VUS=40
   ```
   No Grafana, "Recebidos" sobe, a **fila do worker** cresce e é drenada pelas 3 réplicas, e "Concluídos" alcança "Recebidos" com **0 falhas**. O k6 termina com `✓ nenhum vídeo perdido (todos concluídos)`.
6. **Escala** (opcional, se sobrar tempo): `make scale n=1`, nova rajada, a fila demora mais; `make scale n=3`, a fila volta a drenar rápido.

## Dicas

- Grave em 1080p com zoom no navegador em 110–125%, para o texto ficar legível.
- Se a demo travar, `make ps` mostra o estado e `make logs s=processor` mostra o worker.
- Para começar do zero: `make clean && make up`.
