# auth-service

Cadastro, login e sessão dos usuários do FIAP X. Contrato: [contracts/openapi/auth.yaml](../../contracts/openapi/auth.yaml).

| | |
|---|---|
| Stack | Node 22 + NestJS 11 (TypeScript) |
| Porta | 3001 (pelo gateway: `/api/auth/*`) |
| Banco | `auth_db` (PostgreSQL, acessado só por este serviço) |
| Outras dependências | Redis (rate limit de login) |

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | Cria a conta → `201` (`409` e-mail já existe, `400` dados inválidos) |
| POST | `/auth/login` | Autentica → `200` com `access_token` + cookie `refresh_token` (`401`, `429`) |
| POST | `/auth/refresh` | Troca o cookie por um novo par de tokens (rotação) |
| POST | `/auth/logout` | Revoga a sessão e apaga o cookie → `204` |
| GET | `/auth/me` | Usuário autenticado (`Authorization: Bearer`) |
| GET | `/.well-known/jwks.json` | Chave pública para outros serviços validarem o JWT *(interno)* |
| GET | `/health` | Verifica banco e Redis *(interno)* |
| GET | `/metrics` | Métricas Prometheus *(interno)* |

As rotas internas não são expostas pelo gateway.

## Segurança

- **Senha:** bcrypt (cost 12). Regra: mínimo 8 caracteres, com letra e número, até 72 bytes (limite do bcrypt).
- **Access token:** JWT RS256 de 15 min, com `sub`, `email`, `name`, `iss=fiapx-auth` e `aud=fiapx`. Os outros serviços validam o token localmente pelo JWKS.
- **Refresh token:** 256 bits aleatórios, válido por 7 dias, guardado só como sha256. Vai num cookie `HttpOnly; SameSite=Strict; Path=/api/auth`.
- **Rotação:** cada uso do refresh gera um token novo. Reusar um token antigo revoga toda a família, o que detecta roubo de token.
- **Rate limit:** 5 falhas a cada 15 min por e-mail + IP, compartilhado entre réplicas via Redis. Depois disso o login responde `429` com `Retry-After`.
- **Mensagens genéricas:** "E-mail ou senha inválidos". Quando o e-mail não existe, o login compara contra um hash fictício para não revelar, pelo tempo de resposta, quais e-mails estão cadastrados.
- **Logs:** sem senha, token, cookie ou header `Authorization`.

## Arquitetura (Clean Architecture)

```
src/
  domain/            entidades e regras puras (User, política de senha, estado do refresh token, erros)
  application/       casos de uso (RegisterUser, Login, RefreshSession, Logout, GetCurrentUser) + portas
  infrastructure/
    persistence/     PostgreSQL (pg) + executor de migrations
    security/        bcrypt, JWT RS256/JWKS (jose), geração de tokens opacos
    rate-limit/      Redis
    http/            controllers, DTOs, guard JWT, filtro de erros
    observability/   métricas Prometheus
  auth.module.ts     composição: liga cada porta à implementação
migrations/          SQL versionado (aplicado no boot, com advisory lock)
```

Os casos de uso não dependem do Nest nem do banco: recebem as portas no construtor e são testados com dublês em memória.

## Rodar

Pelo compose (recomendado), na raiz do repositório:

```bash
make up        # gera a chave RS256 em infra/secrets/ e sobe tudo
curl -X POST localhost:8080/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Ana","email":"ana@exemplo.com","password":"senhaForte1"}'
```

Fora do Docker, com a infra do compose rodando:

```bash
cp .env.example .env && npm ci
npm run start:dev
```

## Testes

```bash
npm run test:cov   # unitários (casos de uso, segurança), gate de 80% de cobertura
npm run test:e2e   # integração: Postgres e Redis reais via Testcontainers (requer Docker)
npm run lint && npm run typecheck
```

## Variáveis de ambiente

Ver [.env.example](.env.example). Em produção, `JWT_PRIVATE_KEY_FILE` (ou `JWT_PRIVATE_KEY`) é obrigatória. Todas as réplicas precisam da mesma chave, senão um token emitido por uma não é aceito pelas outras.
