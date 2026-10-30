#!/bin/sh
# Carga los datos semilla. Todos los archivos son idempotentes: se puede ejecutar en cada arranque.
#   base/  configuración, festivos, equipos, etapas del flujo y administrador (siempre)
#   demo/  áreas, usuarios y proveedores de prueba (solo con SEED_DEMO=true)
set -eu

aplicar() {
  for archivo in "$1"/*.sql; do
    echo "→ $archivo"
    psql -v ON_ERROR_STOP=1 -q \
      -v admin_email="$ADMIN_EMAIL" \
      -v admin_nombre="$ADMIN_NOMBRE" \
      -v admin_password="$ADMIN_PASSWORD" \
      -v demo_password="${DEMO_PASSWORD:-}" \
      -f "$archivo"
  done
}

aplicar /seeds/base

if [ "${SEED_DEMO:-false}" = "true" ]; then
  aplicar /seeds/demo
else
  echo "SEED_DEMO distinto de true: se omiten los datos de prueba"
fi

echo "Semillas aplicadas"
