-- video_db — tabelas da video-api (nenhum outro serviço acessa este banco)

CREATE TYPE video_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

CREATE TABLE videos (
    id                UUID         NOT NULL,
    user_id           UUID         NOT NULL,       -- sem FK: o usuário vive no auth_db
    user_email        VARCHAR(255) NOT NULL,       -- vem do JWT; usado na notificação de falha
    original_filename VARCHAR(255) NOT NULL,
    size_bytes        BIGINT       NOT NULL,
    storage_key       VARCHAR(512) NOT NULL,       -- bucket raw-videos: <user_id>/<video_id>.<ext>
    zip_key           VARCHAR(512),                -- bucket frame-zips: <user_id>/<video_id>.zip
    status            video_status NOT NULL DEFAULT 'PENDING',
    frame_count       INT,
    error_message     TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT videos_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_videos_user_created ON videos (user_id, created_at DESC);

-- Transactional outbox: gravada na mesma transação do vídeo e publicada no RabbitMQ
-- pelo relay. Garante que nenhum upload aceito fique sem mensagem, mesmo se o
-- RabbitMQ estiver fora do ar no momento do upload.
CREATE TABLE outbox (
    id           BIGSERIAL    NOT NULL,
    exchange     VARCHAR(100) NOT NULL,
    routing_key  VARCHAR(100) NOT NULL,
    message_id   UUID         NOT NULL,
    payload      JSONB        NOT NULL,
    headers      JSONB        NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    attempts     INT          NOT NULL DEFAULT 0,
    last_error   TEXT,
    CONSTRAINT outbox_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_outbox_pending ON outbox (id) WHERE published_at IS NULL;
