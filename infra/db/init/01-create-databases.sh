#!/bin/bash
# Cria um database e um usuário para cada serviço (banco por serviço).
# Executado automaticamente pelo container do PostgreSQL na primeira inicialização
# (/docker-entrypoint-initdb.d). As tabelas são criadas pelas migrations de cada serviço:
#   services/auth/prisma/migrations       -> auth_db
#   services/video-api/prisma/migrations  -> video_db
set -euo pipefail

create_db() {
  local db="$1" user="$2" password="$3"
  echo "Criando database '${db}' com owner '${user}'"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v db="$db" -v usr="$user" -v pwd="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'usr', :'pwd')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usr') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'usr')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SQL
}

create_db "${AUTH_DB_NAME:-auth_db}"   "${AUTH_DB_USER:-auth_user}"   "${AUTH_DB_PASSWORD:-auth_pass}"
create_db "${VIDEO_DB_NAME:-video_db}" "${VIDEO_DB_USER:-video_user}" "${VIDEO_DB_PASSWORD:-video_pass}"
