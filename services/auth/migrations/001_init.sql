-- auth_db — tabelas do auth-service (nenhum outro serviço acessa este banco)

CREATE TABLE users (
    id            UUID         NOT NULL DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    email         VARCHAR(255) NOT NULL,           -- normalizado: trim + minúsculas
    password_hash VARCHAR(255) NOT NULL,           -- bcrypt
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TABLE refresh_tokens (
    id          UUID        NOT NULL,
    user_id     UUID        NOT NULL,
    family_id   UUID        NOT NULL,              -- tokens rotacionados a partir do mesmo login
    token_hash  CHAR(64)    NOT NULL,              -- sha256 do token; o token nunca é salvo
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    replaced_by UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_refresh_user   ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_family ON refresh_tokens (family_id);
