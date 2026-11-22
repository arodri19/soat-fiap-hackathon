# 0008 — `pg` + SQL puro em vez de Prisma

- **Status:** aceita (2026-11-21)

## Contexto
O plano inicial previa Prisma nos serviços Node. Na implementação do auth, o `npm audit` do CI (nível high) reprovou o Prisma 6: o `@prisma/client` declara a CLI `prisma` como dependência, e ela traz vulnerabilidades altas (`deepmerge-ts`, `effect`). A correção só existe no Prisma 7, que muda bastante a configuração (driver adapters, `prisma.config.ts`).

## Decisão
- Usar `pg` (node-postgres) com **SQL explícito** nos repositórios.
- As migrations ficam em arquivos `migrations/NNN_nome.sql`, aplicadas por um executor pequeno com *advisory lock* (seguro com várias réplicas subindo juntas) e registro em `schema_migrations`.

## Alternativas
- **Prisma 7:** reescrever a configuração com risco no prazo.
- **Abrir exceção no audit:** esconderia o problema.
- **TypeORM ou Knex:** outra dependência pesada para poucas tabelas.

## Consequências
- Os arquivos `.sql` são o próprio "script de criação do banco" pedido no PDF.
- A imagem do auth caiu de 537 MB para 209 MB (sem os engines do Prisma).
- O SQL é escrito à mão, o que é aceitável com 4 tabelas, e os repositórios ficam isolados atrás das portas: os testes de integração (Testcontainers) cobrem as queries.
