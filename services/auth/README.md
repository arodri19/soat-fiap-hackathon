# auth-service

> Ainda não implementado — previsto na **Fase 1**.

Cadastro, login (bcrypt), emissão de JWT RS256, refresh token com rotação em cookie HttpOnly, logout, `GET /auth/me` e JWKS para os outros serviços validarem o token. Rate limit de login no Redis.

| | |
|---|---|
| Linguagem | Node 20 + NestJS (TypeScript) |
| Porta | 3001 |
| Depende de | `auth_db` (PostgreSQL) e Redis |
| Contrato | [contracts/openapi/auth.yaml](../../contracts/openapi/auth.yaml) |
