#!/bin/sh
# Prepara MinIO: bucket privado + usuario de la aplicación limitado a ese bucket. Idempotente.
set -eu

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"
# Los soportes son evidencia: se conservan todas las versiones de cada objeto
mc version enable "local/$S3_BUCKET"

sed "s/__BUCKET__/$S3_BUCKET/g" /minio/politica-app.json > /tmp/politica-app.json
mc admin policy create local gastos-app /tmp/politica-app.json 2>/dev/null \
  || echo "La política gastos-app ya existe"

mc admin user add local "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc admin policy attach local gastos-app --user "$S3_ACCESS_KEY" 2>/dev/null \
  || echo "La política ya estaba asignada a $S3_ACCESS_KEY"

echo "MinIO listo: bucket $S3_BUCKET"
