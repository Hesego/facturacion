#!/bin/sh
# Se ejecuta UNA sola vez, cuando el volumen de PostgreSQL está vacío.
# Crea los roles y las bases de datos. El esquema lo crean las migraciones (servicio `migrate`).
#
#   gastos_owner  dueño del esquema `gastos`; ejecuta migraciones y semillas
#   gastos_app    rol de la aplicación; no puede editar ni borrar el historial
#   gastos_n8n    rol de n8n; solo lee vistas de SLA y escribe en notificaciones_log
#   n8n           dueño de la base interna de n8n
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$GASTOS_OWNER_PASSWORD" \
  -v app_pw="$GASTOS_APP_PASSWORD" \
  -v n8n_gastos_pw="$GASTOS_N8N_PASSWORD" \
  -v n8n_db_pw="$N8N_DB_PASSWORD" <<'EOSQL'
CREATE ROLE gastos_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE gastos_app   LOGIN PASSWORD :'app_pw';
CREATE ROLE gastos_n8n   LOGIN PASSWORD :'n8n_gastos_pw';
CREATE ROLE n8n          LOGIN PASSWORD :'n8n_db_pw';

CREATE DATABASE gastos OWNER gastos_owner;
CREATE DATABASE n8n    OWNER n8n;

REVOKE ALL ON DATABASE gastos FROM PUBLIC;
GRANT CONNECT ON DATABASE gastos TO gastos_app, gastos_n8n;
REVOKE ALL ON DATABASE n8n FROM PUBLIC;

ALTER DATABASE gastos SET timezone TO 'America/Bogota';

\connect gastos
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gastos_app, gastos_n8n;
EOSQL
