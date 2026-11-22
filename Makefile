.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help keys up down clean ps logs scale config lint-contracts processor-test processor-lint

help: ## Lista os comandos
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

INIT_JOBS := minio-init
LONG_RUNNING := $(filter-out $(INIT_JOBS),$(shell $(COMPOSE) config --services 2>/dev/null))

keys: ## Gera a chave RS256 do JWT em infra/secrets (uma vez)
	@mkdir -p infra/secrets
	@test -f infra/secrets/jwt-private.pem \
		|| (openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out infra/secrets/jwt-private.pem 2>/dev/null \
		&& chmod 644 infra/secrets/jwt-private.pem && echo "Chave criada em infra/secrets/jwt-private.pem")

up: keys ## Sobe a infraestrutura e os serviços (gera a chave do JWT se faltar)
	$(COMPOSE) up -d --build --wait $(LONG_RUNNING)
	$(COMPOSE) up --no-log-prefix $(INIT_JOBS)

down: ## Derruba os containers (mantém os dados)
	$(COMPOSE) down

clean: ## Derruba os containers e apaga os volumes
	$(COMPOSE) down -v

ps: ## Status dos containers
	$(COMPOSE) ps

logs: ## Acompanha os logs (ex.: make logs s=rabbitmq)
	$(COMPOSE) logs -f $(s)

scale: ## Escala o worker (ex.: make scale n=3)
	$(COMPOSE) up -d --no-recreate --scale processor=$(or $(n),2) processor

config: ## Valida o docker-compose.yml
	$(COMPOSE) config -q && echo "docker-compose.yml válido"

lint-contracts: ## Valida os contratos OpenAPI e AsyncAPI
	npx --yes @redocly/cli@1.25.11 lint --config contracts/redocly.yaml contracts/openapi/auth.yaml contracts/openapi/videos.yaml
	npx --yes @asyncapi/cli@2.7.1 validate contracts/asyncapi.yaml

# ---------------------------------------------------------------- processor (Go via Docker: não precisa de Go instalado)
GO_DEV_IMAGE := fiapx-processor-dev
GO_CACHE := $(HOME)/.cache/fiapx-go
UID_GID := $(shell id -u):$(shell id -g)
DOCKER_GID := $(shell stat -c %g /var/run/docker.sock 2>/dev/null)
GO_ENV := -e HOME=/tmp -e GOMODCACHE=/cache/mod -e GOCACHE=/cache/build -e GOFLAGS=-buildvcs=false

processor-test: ## Testes do processor (unitários + E2E com Testcontainers) em container
	@mkdir -p $(GO_CACHE)
	docker build -q --target dev -t $(GO_DEV_IMAGE) services/processor >/dev/null
	docker run --rm -u $(UID_GID) --group-add $(DOCKER_GID) --network host \
		-v /var/run/docker.sock:/var/run/docker.sock -v $(CURDIR):/repo -v $(GO_CACHE):/cache \
		$(GO_ENV) -e TESTCONTAINERS_RYUK_DISABLED=true -w /repo/services/processor \
		$(GO_DEV_IMAGE) go test -race -cover -timeout 10m ./...

processor-lint: ## golangci-lint v2 + govulncheck do processor em container
	@mkdir -p $(GO_CACHE)
	docker run --rm -u $(UID_GID) -v $(CURDIR)/services/processor:/app -v $(GO_CACHE):/cache \
		$(GO_ENV) -e GOLANGCI_LINT_CACHE=/cache/lint -w /app \
		golangci/golangci-lint:v2.15.0 golangci-lint run ./...
	docker build -q --target dev -t $(GO_DEV_IMAGE) services/processor >/dev/null
	docker run --rm -u $(UID_GID) -v $(CURDIR):/repo -v $(GO_CACHE):/cache $(GO_ENV) \
		-w /repo/services/processor $(GO_DEV_IMAGE) go run golang.org/x/vuln/cmd/govulncheck@latest ./...
