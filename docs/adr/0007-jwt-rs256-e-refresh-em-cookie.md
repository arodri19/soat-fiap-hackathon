# 0007 — JWT RS256 + refresh token rotativo em cookie HttpOnly

- **Status:** aceita (2026-11-21)

## Contexto
O PDF pede proteção por usuário e senha. Várias APIs precisam saber quem é o usuário sem chamar o auth a cada requisição, e o front é uma SPA.

## Decisão
- **Access token:** JWT **RS256** de 15 min. O auth publica a chave pública em `/.well-known/jwks.json`, e a video-api valida localmente, com a chave em cache.
- **Refresh token:** 256 bits aleatórios em cookie `HttpOnly; SameSite=Strict; Path=/api/auth`, guardado só como sha256, válido por 7 dias.
  - É rotacionado a cada uso.
  - Se um token já usado aparecer de novo, a família inteira é revogada (detecção de roubo).
- **No front:** o access token fica só em memória. O interceptor renova a sessão uma única vez em `401` (*single-flight*) e repete a requisição.
- **Senhas e tentativas:** senha com bcrypt (cost 12) e limite de 5 falhas por e-mail + IP a cada 15 min, no Redis.

## Alternativas
- **HS256 (segredo compartilhado):** todo serviço que valida também poderia emitir tokens.
- **Token no `localStorage`:** exposto a XSS.
- **Sessão no servidor (cookie de sessão):** exige consultar o estado a cada requisição em todos os serviços.

## Consequências
- Front e API na mesma origem (gateway) para o cookie funcionar sem CORS.
- Todas as réplicas do auth precisam da mesma chave privada (*secret* `jwt_private_key`, gerado por `make keys`).
