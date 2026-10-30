#!/bin/sh
# Prepara la base y el almacenamiento y termina. Idempotente: corre en cada despliegue del stack.
set -eu

echo "Esperando a PostgreSQL en $PGHOST..."
until pg_isready -h "$PGHOST" -p "${PGPORT:-5432}" -q; do sleep 3; done

echo "Aplicando migraciones"
export DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:${PGPORT:-5432}/$PGDATABASE?sslmode=disable"
dbmate --migrations-dir /db/migrations --no-dump-schema --wait up

sh /seeds/aplicar.sh
sh /minio/init.sh

echo "Inicialización completa"
