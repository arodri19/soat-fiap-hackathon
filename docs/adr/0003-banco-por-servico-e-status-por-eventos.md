# 0003 — Banco por serviço; status atualizado por eventos

- **Status:** aceita (2026-11-21)

## Contexto
O worker precisa informar o andamento do processamento. O caminho mais curto seria ele atualizar a tabela `videos` diretamente, mas isso faria dois serviços dividirem o mesmo banco.

## Decisão
- Cada serviço é dono dos próprios dados: `auth_db` (auth) e `video_db` (video-api), com usuários distintos. Um não tem permissão no banco do outro.
- O **worker não tem banco**: ele publica `video.processing`, `video.done` e `video.failed`, e a **video-api** consome esses eventos e atualiza o status.
- A transição é idempotente e só avança (`UPDATE … WHERE status = ANY(<anteriores permitidos>)`): evento repetido ou fora de ordem é ignorado.
- O `user_id` em `videos` não tem FK, porque o usuário vive em outro banco. O `user_email` vem do JWT e segue nos eventos, para o notification não depender do auth.

## Alternativas
- **Banco compartilhado:** mais simples, mas acopla esquema e deploy e quebra a independência dos serviços.
- **Worker chamando a video-api por HTTP:** acoplamento síncrono; se a API estiver fora, o worker trava ou perde a atualização.

## Consequências
- Consistência eventual: o status aparece alguns milissegundos depois do evento.
- O mesmo `video.failed` é consumido por dois serviços independentes (status e e-mail), cada um com a própria fila.
- Escalar ou trocar o worker não afeta o esquema do banco.
