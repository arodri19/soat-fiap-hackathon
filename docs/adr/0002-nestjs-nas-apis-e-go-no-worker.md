# 0002 — NestJS nas APIs e Go só no worker

- **Status:** aceita (2026-11-21)

## Contexto
O projeto base é Go, mas o desenvolvedor domina Node e .NET. Escrever todos os serviços em uma linguagem pouco familiar aumentaria o risco no prazo do hackathon.

## Decisão
- **Node 22 + NestJS 11 (TypeScript)** no auth-service, na video-api e no notification. É a mesma linguagem do frontend, e a estrutura do NestJS (módulos, injeção de dependência, guards) é próxima da do ASP.NET Core.
- **Go** só no **processor-worker**, onde ele faz mais diferença:
  - reaproveita quase sem mudanças o `processVideo`/`createZipFile` do projeto base;
  - goroutines tornam trivial processar N vídeos ao mesmo tempo por réplica;
  - o binário é estático, a imagem tem ~150 MB com ffmpeg e o start é rápido, o que facilita escalar pela fila;
  - é o serviço com menos regras de negócio, então pouco Go novo precisa ser escrito.

## Alternativas
- **Tudo em Go:** consistente com o projeto base, mas com mais risco por falta de familiaridade.
- **Tudo em .NET:** produtivo para o desenvolvedor, mas perde o reaproveitamento do código Go e gera imagens maiores para o worker.
- **Tudo em Node:** possível (ffmpeg é um processo externo), mas a concorrência e o tratamento de erros do worker ficam mais frágeis.

## Consequências
- Duas toolchains no CI (workflows reutilizáveis `_node-service` e `_go-service`).
- Demonstra uma propriedade de microsserviços: cada serviço usa a tecnologia mais adequada e só se comunica por contrato.
- Para trabalhar no worker sem Go instalado: `make processor-test` e `make processor-lint` rodam em container.
