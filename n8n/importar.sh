#!/bin/sh
# Importa en n8n las credenciales y los 4 workflows del flujo de gastos, y los deja activos.
# Se ejecuta DENTRO del contenedor de n8n:
#   docker compose exec n8n sh /flujo/importar.sh
#   docker compose restart n8n
# Es idempotente: volver a ejecutarlo actualiza credenciales y workflows con los mismos ids.
set -eu

# Credenciales con ids fijos (los mismos que referencian los workflows). Los datos salen de las
# variables de entorno del contenedor; el archivo temporal se borra al terminar.
node -e '
const e = process.env;
const seguro = e.SMTP_SECURE === "true";
const credenciales = [
  { id: "gastosPostgres01", name: "Postgres Gastos (n8n)", type: "postgres",
    data: { host: e.GASTOS_DB_HOST || "postgres", port: 5432, database: "gastos", user: "gastos_n8n", password: e.GASTOS_N8N_PASSWORD, ssl: "disable" } },
  { id: "gastosSmtp000001", name: "SMTP Gastos", type: "smtp",
    data: { host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), secure: seguro, user: e.SMTP_USER || "", password: e.SMTP_PASSWORD || "",
            disableStartTls: !seguro && !e.SMTP_USER } },
];
require("fs").writeFileSync("/tmp/credenciales-gastos.json", JSON.stringify(credenciales));
'
trap 'rm -f /tmp/credenciales-gastos.json' EXIT

n8n import:credentials --input=/tmp/credenciales-gastos.json
n8n import:workflow --separate --input=/flujo/workflows
n8n update:workflow --all --active=true

echo
echo "Listo: credenciales y workflows importados."
echo "Reinicie n8n para activar los webhooks:  docker compose restart n8n"
