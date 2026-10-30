# Flujo de gastos · Hesego Ingeniería

Plataforma web de **control** del ciclo de vida de un gasto: desde que contabilidad sube la factura hasta que se paga y se avisa del cierre. No reemplaza el proceso contable (que vive en otra plataforma): aquí se hace el seguimiento. En cada paso, quien tiene la transacción sube su documento, escribe su número y elige a la persona que sigue; el sistema valida y le avisa.

```
SOL → RQ → AP → OC → AG → ES → PG_ENV → PG_APR → RP → FT
```

| Código | Etapa | Responsable |
|---|---|---|
| SOL | Solicitud de gasto: factura + número + a quién | Contabilidad |
| RQ | Requerimiento | Operaciones |
| AP | Aprobación del RQ | Líder de operaciones |
| OC | Orden de compra | Compras |
| AG | Aprobación de la OC | Gerencia |
| ES | Entrega de servicio | Operaciones |
| PG_ENV | Envío a aprobación de pago | Contabilidad |
| PG_APR | Aprobación de pago | Gerencia financiera |
| RP | Pago | Contabilidad |
| FT | Cierre | Sistema (avisa a todos los participantes) |

| Documento | Contenido |
|---|---|
| [`docs/decisiones.md`](docs/decisiones.md) | Decisiones acordadas (simplificación, asignación a una persona, PG en dos subetapas, SLA…) |
| [`docs/api.md`](docs/api.md) | Rutas de la API y códigos de error |
| [`docs/n8n.md`](docs/n8n.md) | Outbox, workflows, correo con Microsoft 365, otros canales |
| [`docs/despliegue.md`](docs/despliegue.md) | Despliegue en Portainer (Swarm, red `hesegonet`, Traefik) y variables del stack |
| [`brand/README.md`](brand/README.md) | Archivos maestros de marca pendientes |

---

## Arquitectura

```
Navegador ──▶ web (nginx + React) ──/api──▶ api (Node + TypeScript) ──▶ PostgreSQL  (fuente única de verdad)
                                              │   │                         ▲
                                              │   └──▶ MinIO / S3 (soportes) │ rol de solo lectura de SLA
                                              └── relay del outbox ──▶ n8n ──┘──▶ correo (Mailpit · Microsoft 365)
```

- **PostgreSQL** guarda el estado y además protege las reglas críticas aunque alguien se salte la API:
  - Un cambio de etapa sin su evento de auditoría y su outbox se rechaza al hacer `COMMIT`.
  - El historial es de solo inserción: no se puede editar ni borrar.
  - Las facturas duplicadas se bloquean con índices únicos.
  - Una transacción pagada o anulada ya no se puede modificar.
- **La API** contiene la máquina de estados, las validaciones, la carga de archivos y la auditoría. Se conecta con un rol que no puede editar ni borrar el historial.
- **n8n** solo notifica: recibe los eventos con los destinatarios ya resueltos y no decide nada.
- **Los archivos** van a S3 (MinIO en local). En Postgres solo quedan sus metadatos, su clave y su SHA-256.

**Stack:** TypeScript en todo el código. La API usa Fastify, Kysely y Zod. La interfaz usa React, Vite, TanStack Query y Tailwind con los tokens del Manual de Marca. Las migraciones son SQL plano aplicadas con dbmate. Es un monorepo pnpm.

---

## Instalación con Docker

Requisitos: Docker con Compose v2. Todas las imágenes son de Docker Hub con versión fija.

```bash
cp .env.example .env               # cambie TODAS las claves (ver tabla de variables)
docker compose up -d --build
docker compose logs migrate seed   # verifique que terminaron sin error
```

| Servicio | Qué es | URL local |
|---|---|---|
| `web` | La aplicación | **http://localhost:8080** |
| `api` | API (la interfaz la usa por `/api`) | http://localhost:3000/api/salud |
| `n8n` | Notificaciones | http://localhost:5678 |
| `mailpit` | Bandeja de correos de desarrollo | http://localhost:8025 |
| `minio` | Consola del almacenamiento | http://localhost:9001 |
| `postgres` | Base de datos (`gastos` y `n8n`) | localhost:5432 |
| `migrate`, `seed`, `minio-init` | Preparan la base y el bucket, y terminan | — |

**Primer ingreso:** entre con el correo y la contraseña que definió en `ADMIN_EMAIL` y `ADMIN_PASSWORD` del `.env`. Con el `.env.example` sin cambios son `admin@hesego.test` / `cambiar-admin`: **cámbiela antes de usar la plataforma con datos reales.** Si `SEED_DEMO=true`, también existen los usuarios de prueba (ver más abajo).

> `db/init/01-roles-y-bases.sh` crea los roles y las bases **solo la primera vez** que se crea el volumen de Postgres. Si después cambia esas claves en `.env`, cámbielas también en la base, o recree el volumen con `docker compose down -v` (borra todos los datos). El administrador inicial tampoco se vuelve a crear: su contraseña se cambia desde *Administración → Usuarios*.

### Importar los workflows de n8n

```bash
docker compose exec n8n sh /flujo/importar.sh
docker compose restart n8n
```

El script crea las credenciales (Postgres con el rol restringido `gastos_n8n` y SMTP), importa los 4 workflows de `n8n/workflows/` y los deja activos. Se puede volver a ejecutar. En local los correos llegan a Mailpit. Para Microsoft 365 y otros canales, vea [`docs/n8n.md`](docs/n8n.md).

### Variables de entorno (`.env`)

| Variable | Para qué |
|---|---|
| `POSTGRES_SUPERUSER_PASSWORD` | Superusuario de Postgres (solo para el arranque inicial) |
| `GASTOS_OWNER_PASSWORD` | Dueño del esquema: migraciones y semillas |
| `GASTOS_APP_PASSWORD` | Rol de la API (`gastos_app`) |
| `GASTOS_N8N_PASSWORD` | Rol de n8n (`gastos_n8n`): lee la vista de SLA y escribe en `notificaciones_log` |
| `N8N_DB_PASSWORD` | Base interna de n8n |
| `ADMIN_EMAIL`, `ADMIN_NOMBRE`, `ADMIN_PASSWORD` | Administrador inicial |
| `SEED_DEMO`, `DEMO_PASSWORD` | `true` crea usuarios de prueba. **`false` en producción** |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Administrador de MinIO |
| `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Bucket privado y usuario de la API (solo lee y escribe en ese bucket; no borra) |
| `N8N_ENCRYPTION_KEY` | Cifra las credenciales de n8n. Genérela con `openssl rand -hex 32` y no la cambie después |
| `N8N_WEBHOOK_TOKEN` | Token compartido entre el relay de la API y los webhooks de n8n |
| `N8N_HOST`, `N8N_WEBHOOK_URL`, `N8N_SECURE_COOKIE` | Dirección pública de n8n |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | Correo saliente (Mailpit en local, Microsoft 365 en producción) |
| `APP_URL` | URL pública de la aplicación (enlaces de los correos) |
| `SESION_HORAS` | Duración de la sesión |
| `COOKIE_SECURE` | `true` en producción (requiere HTTPS) |
| `POSTGRES_PORT`, `API_PORT`, `WEB_PORT`, `N8N_PORT`, `MINIO_*_PORT`, `MAILPIT_UI_PORT` | Puertos publicados en el equipo |

---

## Ver la aplicación sin Docker (modo demo)

Requiere Node 22 y pnpm 9.

```bash
pnpm install
pnpm demo
```

Abra **http://localhost:5173**. El demo levanta la API con Postgres embebido, almacenamiento en memoria y gastos de ejemplo en todas las etapas (algunos con el XML de la DIAN), con todos los colores del semáforo y gastos ya pagados para el tablero. Los datos se pierden al cerrarlo y no se envían correos.

La clave de **todos** los usuarios del demo, incluido el administrador, es `Hesego2026*`.

| Para ver… | Entre como |
|---|---|
| Administración (usuarios, equipos, etapas…) | admin@hesego.test |
| Crear solicitudes con facturas | contabilidad1@hesego.test |
| Un RQ rechazado por el líder | ops.sst@hesego.test |
| Aprobar un RQ que le enviaron | lider.tics@hesego.test |
| Una OC vencida (semáforo rojo) | gerencia1@hesego.test |
| Aprobar un pago | gfinanciera1@hesego.test |
| Segregación de funciones | doble.rol@hesego.test |

---

## Cómo agregar o modificar una etapa

El flujo se define en la tabla `catalogo_etapas`, no en el código. Un gasto avanza a la **siguiente etapa activa según `orden`**.

### Desde la aplicación (recomendado)

**Administración → Etapas del flujo.** Allí se puede:

- **Modificar** una etapa: nombre, equipo responsable (a sus miembros se les puede enviar), plazo (SLA) en días hábiles, etapa a la que devuelve, segregación de funciones y requisitos para avanzar (número RQ/OC/ES/CP, documento con cantidad mínima, facturas y comentario obligatorio).
- **Agregar** una etapa con *Nueva etapa*. Por defecto se ubica justo antes del cierre. Ajuste el `orden` para intercalarla, por ejemplo 55 para que quede entre AG (50) y ES (60).
- **Reordenar** las etapas con las flechas.
- **Desactivar** una etapa: deja de usarse y conserva su historial.

La plataforma impide los cambios que romperían el flujo:

- Desactivar una etapa que tiene gastos en curso.
- Devolver a una etapa posterior. Esto también aplica al reordenar: si AG devuelve a OC, AG no puede quedar antes de OC.
- Que el cierre del sistema deje de ser la última etapa.
- Que la primera etapa sea de aprobación.
- Cambiar el código de una etapa que ya tiene historial.

Los cambios aplican de inmediato, también a los gastos que ya están en esa etapa.

### Con SQL (por ejemplo, en una migración nueva)

```sql
-- Ejemplo: visto bueno de compras entre la aprobación de la OC (50) y la entrega del servicio (60)
INSERT INTO catalogo_etapas (codigo, grupo, orden, nombre, tipo, equipo_id, sla_dias, segregacion, requisitos, etapa_devolucion_id)
SELECT 'VB', 'VB', 55, 'Visto bueno de compras', 'ejecucion', q.id, 2, false,
       '{"comentario_obligatorio": true, "adjuntos": [{"tipo": "acta_vb", "etiqueta": "Acta de visto bueno", "min": 1}]}',
       (SELECT id FROM catalogo_etapas WHERE codigo = 'AG')
FROM equipos q WHERE q.codigo = 'compras';
```

Para que ES devuelva a la nueva etapa, actualice `etapa_devolucion_id` de ES. Las claves válidas de `requisitos` están documentadas en `packages/shared/src/requisitos.ts` y se validan al guardar y al avanzar:

| Clave | Ejemplo | Exige |
|---|---|---|
| `referencias` | `[{"tipo":"RQ","etiqueta":"Número de RQ"}]` | Registrar el número en esta etapa (único en el sistema por tipo) |
| `referencias_previas` | `["RQ","OC","ES"]` | Números ya registrados en etapas anteriores |
| `adjuntos` | `[{"tipo":"evidencia_es","etiqueta":"Evidencia","min":1}]` | Archivos cargados en esta etapa |
| `facturas` | `{"min":1}` | Facturas activas en el gasto |
| `comentario_obligatorio` | `true` | Comentario al avanzar (en aprobaciones, el de la decisión) |

Los avisos de n8n funcionan solos con la etapa nueva: se avisa a la persona a la que se le envía.

---

## Desarrollo y pruebas

```bash
pnpm install
pnpm test          # todas las pruebas, sin Docker
pnpm typecheck
pnpm demo          # API de demostración (:3000) + interfaz con recarga en caliente (:5173)
```

Las pruebas de la API levantan PGlite (Postgres embebido) con las migraciones y semillas del repo y lo exponen por socket, así que se usa el mismo driver `pg` que en producción. **Corren con el rol `gastos_app`:** si algo exige más permisos de los que tiene la aplicación, también falla en las pruebas. Para correrlas contra el Postgres del compose:

```bash
PRUEBAS_DATABASE_URL=postgres://gastos_app:CLAVE@localhost:5432/gastos pnpm --filter @gastos/api test
```

| Archivo | Qué prueba |
|---|---|
| `apps/api/test/flujo.test.ts` | Solicitud creada y enviada en un paso, camino feliz sin saltos, pendientes por persona, número y documento obligatorios (sin dejar nada a medias), destinatario del equipo correcto, versión desactualizada y doble clic, devoluciones a quien envió, reasignación, anulación, etapa nueva agregada solo con el catálogo |
| `apps/api/test/permisos.test.ts` | Solo la persona asignada actúa, solo contabilidad crea, el administrador no ejecuta etapas, quién anula, segregación de funciones al enviar y al reasignar |
| `apps/api/test/facturas.test.ts` | Solo PDF + número, lectura del XML y del ZIP de la DIAN, número del XML, duplicados por número, CUFE y mismo PDF, mismo número de otro proveedor, registros simultáneos, liberación al anular o retirar |
| `apps/api/test/auditoria.test.ts` | Historial inmutable, la base rechaza cambios sin evento y outbox, reversión completa ante fallos, contenido del outbox |
| `apps/api/test/relay.test.ts` | Entrega a n8n con token, reintentos con espera creciente, estado fallido, n8n caído, dos relays sin entregas duplicadas |
| `apps/api/test/n8n-sql.test.ts` | Las consultas de los workflows corren con el rol `gastos_n8n`; la reserva de envíos es idempotente |
| `apps/api/test/administracion.test.ts` | Solo administradores, usuarios y sesiones, no desactivar a quien tiene gastos asignados, validación de etapas y del orden, configuración, cifras del tablero |
| `apps/api/test/http.test.ts` | Login, cookie segura, límite de intentos, solicitud solo con el ZIP de la DIAN, detalle con destinatarios y acciones, completar la etapa en un envío, reasignar, descarga, formato de errores |
| `n8n/probar.test.mjs` | Código de los nodos de n8n: token, destinatarios sin duplicados, contenido y escape del correo, resumen de SLA, días no hábiles, JSON al día con la fuente |

---

## Usuarios de prueba (`SEED_DEMO=true`)

| Correo | Equipo(s) | |
|---|---|---|
| contabilidad1@hesego.test, contabilidad2@hesego.test | Contabilidad | — |
| ops.sst@ · ops.tics@ · ops.inventario@hesego.test | Operaciones | |
| lider.sst@ · lider.tics@ · lider.inventario@hesego.test | Líderes de operaciones | |
| compras1@hesego.test | Compras | — |
| gerencia1@hesego.test | Gerencia | — |
| gfinanciera1@hesego.test | Gerencia financiera | — |
| doble.rol@hesego.test | Contabilidad + gerencia financiera | Para probar la segregación |

La clave es `DEMO_PASSWORD` (por defecto `Hesego2026*`).

---

## Estructura

```
apps/api/           API (Fastify + Kysely)
  src/dominio/        flujo.ts (máquina de estados), facturas y factura-electronica (lectura del XML DIAN), soportes, outbox, autorización, tablero, administración
  src/servicios/      sesiones, almacenamiento S3, relay del outbox
  scripts/            Postgres embebido, escenarios y modo demo
  test/               pruebas automatizadas
apps/web/           interfaz (React + Vite + Tailwind con el manual de marca)
  src/componentes/    sistema visual: tarjetas, chips, semáforo, regla de color, logo
  src/paginas/        login, pendientes, transacciones, nueva solicitud, detalle, tablero, administración
packages/shared/    esquemas Zod y tipos compartidos por la API y la interfaz
db/init/            roles y bases (primer arranque de Postgres)
db/migrations/      esquema en SQL plano (dbmate)
db/seeds/           base/ (siempre) y demo/ (SEED_DEMO=true)
n8n/                fuente/ (plantilla y lógica de correos), generar.mjs, workflows/ (JSON generados), importar.sh
minio/              bucket y política de acceso
brand/              archivos maestros de marca (pendientes)
docs/               decisiones, API y n8n
```

## Marca

La interfaz y los correos aplican el **Manual de Marca Hesego v1.1**:

- **Colores:** paleta de aplicación con sus reglas de contraste. El teal vivo y el naranja vivo nunca se usan como texto pequeño.
- **Tipografía:** Anton, Glacial Indifference, Rajdhani y Saira; Arial y Arial Black como sustitutas.
- **Componentes:** regla de color bajo los titulares, tarjetas con barra de acento, chips en Rajdhani, cifras grandes con su etiqueta, panel navy en diagonal.
- **Íconos y textos:** íconos de trazo y ningún emoji; textos en tuteo.

El semáforo usa una escala de estado validada para daltonismo (verde, ámbar, naranja profundo y rojo oscuro) y siempre va con texto. **El logo y Glacial Indifference esperan los archivos maestros de Comunicaciones** en `brand/`. Mientras tanto se muestra un marcador de texto; el logo nunca se redibuja.
