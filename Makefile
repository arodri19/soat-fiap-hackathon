.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help up down clean ps logs config lint-contracts

help: ## Lista os comandos
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

INIT_JOBS := minio-init
LONG_RUNNING := $(filter-out $(INIT_JOBS),$(shell $(COMPOSE) config --services 2>/dev/null))

up: ## Sobe a infraestrutura local e roda os jobs de inicialização
	$(COMPOSE) up -d --wait $(LONG_RUNNING)
	$(COMPOSE) up --no-log-prefix $(INIT_JOBS)

down: ## Derruba os containers (mantém os dados)
	$(COMPOSE) down

clean: ## Derruba os containers e apaga os volumes
	$(COMPOSE) down -v

ps: ## Status dos containers
	$(COMPOSE) ps

logs: ## Acompanha os logs (ex.: make logs s=rabbitmq)
	$(COMPOSE) logs -f $(s)

config: ## Valida o docker-compose.yml
	$(COMPOSE) config -q && echo "docker-compose.yml válido"

lint-contracts: ## Valida os contratos OpenAPI e AsyncAPI
	npx --yes @redocly/cli@1.25.11 lint --config contracts/redocly.yaml contracts/openapi/auth.yaml contracts/openapi/videos.yaml
	npx --yes @asyncapi/cli@2.7.1 validate contracts/asyncapi.yaml
