#!/bin/sh
# Cria os buckets usados pela solução. Roda no serviço minio-init do compose (cliente mc).
#   raw-videos : vídeos enviados  -> <user_id>/<video_id>.<ext>
#   frame-zips : zips gerados     -> <user_id>/<video_id>.zip
set -eu

: "${MINIO_ENDPOINT:=http://minio:9000}"
: "${MINIO_BUCKET_RAW:=raw-videos}"
: "${MINIO_BUCKET_ZIP:=frame-zips}"

until mc alias set local "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "Aguardando MinIO..."
  sleep 1
done

for bucket in "$MINIO_BUCKET_RAW" "$MINIO_BUCKET_ZIP"; do
  mc mb --ignore-existing "local/$bucket"
  mc anonymous set none "local/$bucket"   # privado: acesso só por URL pré-assinada
done

# Vídeo bruto não é mais necessário depois de processado: expira em 7 dias.
# Só cria a regra se o bucket ainda não tiver ciclo de vida (script idempotente).
if ! mc ilm rule ls "local/$MINIO_BUCKET_RAW" >/dev/null 2>&1; then
  mc ilm rule add --expire-days 7 "local/$MINIO_BUCKET_RAW"
fi

echo "Buckets prontos: $MINIO_BUCKET_RAW, $MINIO_BUCKET_ZIP"
