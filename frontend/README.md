# frontend

Interface web do FIAP X: cadastro e login, envio de vários vídeos com progresso, status atualizado automaticamente, download do zip e um painel com atalhos da infraestrutura para a apresentação.

| | |
|---|---|
| Stack | Vue 3.5 + Vuetify 3 + TypeScript, Vite 7, Pinia, Vue Router, Axios |
| Testes | Vitest + Vue Test Utils + MSW (API simulada) |
| Imagem | nginx não-root servindo a SPA, cerca de 53 MB |
| Acesso | http://localhost:8080, pelo gateway (mesma origem da API) |

## Telas

| Rota | Tela |
|---|---|
| `/login`, `/cadastro` | Entrar e criar conta. As regras de senha são as mesmas do backend, com indicador de força |
| `/videos` | Envio (arrastar e soltar ou seleção múltipla), cards por status que também servem de filtro, tabela paginada, download e mensagem de erro |
| `/apresentacao` | Links para Grafana, RabbitMQ, Mailpit, MinIO e Prometheus, e o roteiro da demonstração |

Tema claro e escuro (a escolha fica salva) e layout responsivo.

## Sessão (login e senha)

- O **access token fica só em memória** (store Pinia), nunca no `localStorage`.
- O **refresh token** fica no cookie `HttpOnly; SameSite=Strict`, definido pelo auth-service. Como o front e a API estão na mesma origem (`/api` via gateway), o cookie funciona sem CORS.
- Ao abrir ou recarregar a página, o guard do router renova a sessão pelo cookie antes de mostrar as rotas protegidas.
- O interceptor do Axios responde a um `401` renovando a sessão **uma única vez** e repetindo a requisição. Chamadas simultâneas esperam a mesma renovação (*single-flight*). Se não der para renovar, o usuário volta para o login com `?redirect=`.

## Status em tempo real

A lista é atualizada a cada 3 s **só enquanto há vídeo na fila ou processando** e só com a aba visível. Quando um vídeo termina ou falha, aparece um aviso.

## Rodar

```bash
# pelo compose (recomendado): make up na raiz → http://localhost:8080

# desenvolvimento com hot reload, usando o backend do compose
npm ci && npm run dev            # http://localhost:5173 (proxy de /api → gateway)

# desenvolvimento sem backend: API simulada no navegador (MSW)
npm run dev:mock
```

No modo simulado, o processamento leva alguns segundos. Arquivos com "erro" ou "corrompido" no nome terminam em erro.

## Testes e qualidade

```bash
npm run test:cov    # stores, interceptors, fila de upload, validações e componentes (gate de 80%)
npm run lint && npm run typecheck
```

## Configuração em runtime

O container gera o `/config.js` a partir das variáveis de ambiente (`docker/40-config.sh`), então a mesma imagem serve qualquer ambiente:

| Variável | Padrão | Descrição |
|---|---|---|
| `API_BASE_URL` | `/api` | Base da API |
| `USE_MOCK` | `false` | `true` liga a API simulada (MSW) |
| `POLL_INTERVAL_MS` | `3000` | Intervalo de atualização |
| `MAX_UPLOAD_MB` | `500` | Limite validado no navegador |
| `GRAFANA_URL`, `RABBITMQ_URL`, `MAILPIT_URL`, `MINIO_URL`, `PROMETHEUS_URL` | vazio | Links do painel da apresentação |
