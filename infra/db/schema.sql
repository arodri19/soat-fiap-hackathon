-- =============================================================================
-- FIAP X — Script de referência do modelo de dados
-- =============================================================================
-- Fonte da verdade: as migrations de cada serviço (Prisma). Este arquivo
-- consolida o esquema para documentação e para criação manual, se necessário.
--
-- Banco por serviço: cada bloco roda em um database diferente e nenhum
-- serviço acessa o database do outro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- auth_db  (auth-service)
-- -----------------------------------------------------------------------------
-- \c auth_db

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,      -- normalizado (trim + minúsculas)
  password_hash VARCHAR(255) NOT NULL,             -- bcrypt, cost 12
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL,                       -- tokens gerados por rotação compartilham a família
  token_hash  CHAR(64) NOT NULL UNIQUE,            -- sha256 do token; o token em si nunca é salvo
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user   ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens (family_id);

-- -----------------------------------------------------------------------------
-- video_db  (video-api)
-- -----------------------------------------------------------------------------
-- \c video_db

DO $$ BEGIN
  CREATE TYPE video_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS videos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,                 -- sem FK: o usuário vive no auth_db
  user_email        VARCHAR(255) NOT NULL,         -- vem do JWT; usado na notificação
  original_filename VARCHAR(255) NOT NULL,
  size_bytes        BIGINT NOT NULL,
  storage_key       VARCHAR(512) NOT NULL,         -- raw-videos/<user_id>/<video_id>.<ext>
  zip_key           VARCHAR(512),                  -- frame-zips/<user_id>/<video_id>.zip
  status            video_status NOT NULL DEFAULT 'PENDING',
  frame_count       INT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_videos_user_created ON videos (user_id, created_at DESC);

-- Transactional outbox: gravada na mesma transação do vídeo e publicada no RabbitMQ
-- por um relay. Garante que nenhum upload aceito fique sem mensagem.
CREATE TABLE IF NOT EXISTS outbox (
  id           BIGSERIAL PRIMARY KEY,
  routing_key  VARCHAR(100) NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (id) WHERE published_at IS NULL;
