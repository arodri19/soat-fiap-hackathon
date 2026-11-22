# 0001 — Monorepo com serviços independentes

- **Status:** aceita (2026-11-21)

## Contexto
O sistema tem cinco componentes implantáveis: auth, video-api, processor, notification e frontend. Microsserviços costumam viver em repositórios separados, mas o projeto tem **uma pessoa** desenvolvendo e um prazo curto. Seis repositórios significariam seis pipelines, seis conjuntos de secrets, seis regras de proteção de branch e PRs coordenados a cada mudança de contrato.

## Decisão
Usar um único repositório, com cada serviço isolado na própria pasta e regras que permitam separá-lo depois:
- cada serviço tem `package.json` ou `go.mod`, Dockerfile, migrations, README e pipeline próprios;
- **nenhum serviço importa código de outro**; o que é comum fica duplicado ou descrito em `contracts/`;
- a comunicação acontece só por HTTP e mensagens, conforme `contracts/` (OpenAPI/AsyncAPI);
- o CI roda apenas os serviços alterados (*path filters*) e publica uma imagem por serviço.

## Alternativas
- **Um repositório por serviço:** independência total, mas o custo operacional fica alto para uma pessoa.
- **Monorepo com código compartilhado (npm workspaces/libs):** menos duplicação, mas acopla os serviços e impede a separação futura.

## Consequências
- Microsserviço é definido por **deploy, banco e ciclo de vida independentes**, e isso continua valendo: imagem, pipeline, banco e versão por serviço.
- Separar um serviço depois é `git subtree split --prefix=services/<nome>`, que preserva o histórico.
- Há pequena duplicação, como o executor de migrations e o tratamento de erros nos serviços Node.
