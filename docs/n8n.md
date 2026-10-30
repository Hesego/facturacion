# Integración con n8n

n8n **solo notifica**. No decide transiciones, no valida nada y no lee las tablas del negocio. Todo lo que necesita lo recibe resuelto de la API, o lo lee de la vista `v_sla_vencidas`.

## Cómo viaja un evento

```
API (una transacción de BD)                      Relay de la API                         n8n
──────────────────────────                       ───────────────                         ───
UPDATE transacciones                    LISTEN outbox_eventos + sondeo cada 15 s
INSERT eventos            ──COMMIT──▶   toma un lote (FOR UPDATE SKIP LOCKED)    ──POST──▶  webhook (token)
INSERT outbox_eventos                   POST a cada webhook del tipo de evento              por cada destinatario:
  (destinatarios ya resueltos)          todos 2xx → estado «enviado»              ◀─200──     reservar en notificaciones_log
                                        falla → reintento 30 s, 1, 2, 4… min (máx. 1 h)       enviar correo → marcar «enviado»
                                        10 intentos → «fallido»
```

- **Patrón outbox:** el evento se escribe en la misma transacción que el cambio de etapa. Si no hay `COMMIT`, no hay notificación, y la base de datos rechaza un cambio de etapa sin su evento y su outbox.
- **Por qué push y no sondeo desde n8n:** la latencia es de segundos, los reintentos con espera creciente quedan en un solo lugar y n8n no necesita permisos sobre el outbox. El evento se marca como procesado cuando n8n confirma, es decir, cuando el workflow terminó de enviar.
- **Idempotencia:** cada envío se reserva en `notificaciones_log` con la clave `outbox_id:flujo:canal:correo`. Si el relay reintenta un evento, lo que ya estaba `enviado` se omite y no se duplican correos. Los mensajes se procesan de uno en uno, así que una falla a mitad de camino no deja enviados sin marcar.

| Evento | Webhooks |
|---|---|
| `transaccion.avanzada` | `gastos-responsables`, `gastos-seguimiento` |
| `transaccion.devuelta` | `gastos-responsables`, `gastos-seguimiento` |
| `transaccion.reasignada` | `gastos-responsables` |
| `transaccion.anulada` | `gastos-seguimiento` (incluye a los participantes) |
| `transaccion.cerrada` | `gastos-cierre` |

## Workflows

| Archivo | Disparador | A quién |
|---|---|---|
| `1-notificar-responsables.json` | Webhook `gastos-responsables` | La persona a la que se le envió, devolvió o reasignó la transacción |
| `2-notificar-seguimiento.json` | Webhook `gastos-seguimiento` | Solicitante y contabilidad (dueña del proceso), sin quien hizo el cambio |
| `3-recordatorio-sla.json` | Lunes a viernes 7:00, omite festivos | Un correo por persona con sus gastos vencidos, y escalamiento al líder del equipo de la etapa |
| `4-notificar-cierre.json` | Webhook `gastos-cierre` | Todos los que participaron en la transacción |

Los JSON **se generan**: no los edite a mano. Cambie `n8n/fuente/` (`comun.js` tiene la plantilla de correo de marca) y ejecute:

```bash
node n8n/generar.mjs
pnpm --filter @gastos/n8n test     # prueba los nodos Code sin levantar n8n
```

## Importar en n8n

Con el compose arriba:

```bash
docker compose exec n8n sh /flujo/importar.sh
docker compose restart n8n
```

El script crea dos credenciales con ids fijos, a partir de las variables de `.env`, y los workflows quedan enlazados sin tocar nada:

- **Postgres Gastos (n8n)**: usuario `gastos_n8n`. Solo lee `v_sla_vencidas` y `fn_hoy_es_habil()`, y escribe en `notificaciones_log`.
- **SMTP Gastos**: en local, Mailpit; los correos se ven en http://localhost:8025.

Después importa los 4 workflows y los activa. Se puede volver a ejecutar sin problema.

> Si su versión de n8n no acepta credenciales en texto plano al importar, créelas a mano en *Credentials* con esos mismos nombres y vuelva a abrir cada workflow para seleccionarlas.

## Correo en producción (Microsoft 365)

En `.env`:

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=gastos@hesegoingenieria.com
SMTP_PASSWORD=…
MAIL_FROM=Gastos Hesego <gastos@hesegoingenieria.com>
```

El buzón necesita **SMTP AUTH** habilitado en Microsoft 365. `MAIL_FROM` debe ser ese mismo buzón o uno con permiso «Enviar como». Después ejecute de nuevo `importar.sh` y reinicie n8n.

## Agregar Teams, Slack o WhatsApp

1. En `n8n/fuente/comun.js`, agregue el canal a `CANALES` (por ejemplo `['correo', 'teams']`). Cada destinatario recibirá un mensaje por canal, con su propia clave de idempotencia.
2. Regenere con `node n8n/generar.mjs` e importe.
3. En n8n, reemplace el nodo **Teams (por configurar)** por el nodo de Microsoft Teams (o el de Slack o WhatsApp) y conéctelo a **Marcar enviado**. Mientras siga el marcador, esos mensajes quedan como `omitido` en `notificaciones_log`.

## Revisar qué se envió

```sql
-- Notificaciones de una transacción
SELECT tipo, destinatario, estado, intentos, enviado_en, error
FROM notificaciones_log WHERE transaccion_id = 123 ORDER BY creado_en;

-- Eventos que n8n no pudo procesar
SELECT id, tipo, intentos, ultimo_error FROM outbox_eventos WHERE estado = 'fallido';

-- Reintentar un evento fallido
UPDATE outbox_eventos SET estado = 'pendiente', intentos = 0, proximo_intento = now() WHERE id = '…';
```
