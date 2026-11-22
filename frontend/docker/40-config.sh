#!/bin/sh
# Gera config.js a partir das variáveis de ambiente no start do container,
# para a mesma imagem servir em local, homologação e produção.
set -eu

json_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

cat > /usr/share/nginx/html/config.js <<CONF
window.__APP_CONFIG__ = {
  apiBaseUrl: $(json_str "${API_BASE_URL:-/api}"),
  useMock: ${USE_MOCK:-false},
  pollIntervalMs: ${POLL_INTERVAL_MS:-3000},
  maxUploadMb: ${MAX_UPLOAD_MB:-500},
  links: {
    grafana: $(json_str "${GRAFANA_URL:-}"),
    prometheus: $(json_str "${PROMETHEUS_URL:-}"),
    rabbitmq: $(json_str "${RABBITMQ_URL:-}"),
    mailpit: $(json_str "${MAILPIT_URL:-}"),
    minio: $(json_str "${MINIO_URL:-}"),
  },
};
CONF
echo "config.js gerado (USE_MOCK=${USE_MOCK:-false}, API_BASE_URL=${API_BASE_URL:-/api})"
