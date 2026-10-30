# Despliegue en Portainer (Docker Swarm)

El stack `despliegue/portainer-stack.yml` corre en la red compartida `hesegonet` y se publica por
Traefik en `https://facturacion.devops.hesegoingenieria.com`. Solo `fact-web` queda expuesto; la
API, la base, MinIO y n8n se alcanzan únicamente dentro de la red.

## Imágenes

`.github/workflows/docker-publish.yml` las construye y publica en Docker Hub en cada push a `main`:

| Imagen | Contenido |
|---|---|
| `facturacion-web` | Interfaz (nginx); reenvía `/api` a `API_UPSTREAM` |
| `facturacion-api` | API |
| `facturacion-db` | PostgreSQL 16 + `db/init` (roles y bases, solo con volumen vacío) |
| `facturacion-init` | Job: migraciones (dbmate), semillas y bucket de MinIO. Termina en *Complete* |
| `facturacion-n8n` | n8n con los workflows; los importa en cada arranque |

En GitHub (Settings → Secrets and variables → Actions) deben existir los secretos
`DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN`, y opcionalmente la variable `DOCKERHUB_NAMESPACE`.

## Variables de entorno del stack (Portainer → Environment variables)

| Variable | Uso |
|---|---|
| `DOCKERHUB_NAMESPACE` | Usuario u organización de Docker Hub de las imágenes |
| `POSTGRES_SUPERUSER_PASSWORD` | Superusuario de PostgreSQL |
| `GASTOS_OWNER_PASSWORD` | Dueño del esquema (migraciones y semillas) |
| `GASTOS_APP_PASSWORD` | Rol de la API |
| `GASTOS_N8N_PASSWORD` | Rol restringido de n8n en la base `gastos` |
| `N8N_DB_PASSWORD` | Base interna de n8n |
| `N8N_ENCRYPTION_KEY` | `openssl rand -hex 32`. No la cambie después: cifra las credenciales de n8n |
| `N8N_WEBHOOK_TOKEN` | Token compartido entre la API y n8n (mínimo 8 caracteres) |
| `MINIO_ROOT_PASSWORD` | Administrador de MinIO (mínimo 8 caracteres) |
| `S3_SECRET_KEY` | Clave del usuario `gastos-app` de MinIO (mínimo 8 caracteres) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primer administrador de la aplicación |
| `SMTP_USER`, `SMTP_PASSWORD` | Buzón de Microsoft 365 que envía las notificaciones |
| `MAIL_FROM` | Opcional. Por defecto `Gastos Hesego <gastos@hesegoingenieria.com>` |
| `SEED_DEMO`, `DEMO_PASSWORD` | Opcional. `true` carga usuarios de prueba (por defecto `false`) |

Las contraseñas de PostgreSQL van dentro de URLs de conexión: use solo letras, números, `-` y `_`.
Las de roles (`GASTOS_*`, `N8N_DB_PASSWORD`) se fijan al crear el volumen `facturacion_db_data`;
cambiarlas después en Portainer no las cambia en la base.

## Primer despliegue

1. Verifique que el DNS de `facturacion.devops.hesegoingenieria.com` apunte al nodo de Traefik.
2. Portainer → Stacks → Add stack → pegue `despliegue/portainer-stack.yml` y defina las variables.
3. `fact-init` debe terminar en *Complete* (revise sus logs: "Inicialización completa").
   `fact-api` y `fact-n8n` se reinician solos hasta que la base esté lista.
4. Para actualizar: el workflow publica `:latest`; en Portainer use *Update the stack* con
   *Re-pull image*.
