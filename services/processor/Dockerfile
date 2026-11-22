# syntax=docker/dockerfile:1

# ---------- dev: Go + ffmpeg (build, testes e lint locais: make processor-test) ----------
FROM golang:1.27-bookworm AS dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src

# ---------- build: binário estático ----------
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/processor ./cmd/processor

# ---------- runtime: só o binário + ffmpeg, usuário não-root ----------
FROM alpine:3.22 AS runtime
RUN apk add --no-cache ffmpeg ca-certificates \
 && adduser -D -H -u 10001 processor
COPY --from=build /out/processor /usr/local/bin/processor
USER processor
ENV METRICS_ADDR=:9101 \
    WORK_DIR=/tmp/processor
EXPOSE 9101
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9101/health || exit 1
ENTRYPOINT ["/usr/local/bin/processor"]
