#!/bin/sh
# Importa credenciales y workflows (reintenta mientras PostgreSQL arranca) y luego inicia n8n.
# Ojo: cada arranque reemplaza los workflows con la versión de la imagen; edítelos en n8n/fuente.
set -eu

intentos=0
until sh /flujo/importar.sh; do
  intentos=$((intentos + 1))
  if [ "$intentos" -ge 30 ]; then
    echo "No se pudieron importar los workflows de n8n" >&2
    exit 1
  fi
  echo "Reintentando la importación en 5 s..."
  sleep 5
done

exec /docker-entrypoint.sh "$@"
