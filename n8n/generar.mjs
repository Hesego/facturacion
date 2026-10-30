// Genera los workflows de n8n (n8n/workflows/*.json) a partir de n8n/fuente/.
// Así la plantilla de correo y la lógica de envío existen una sola vez.
//   node n8n/generar.mjs
// No edite los JSON a mano: cambie n8n/fuente/ y vuelva a generar.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const fuente = (f) => fs.readFileSync(path.join(DIR, 'fuente', f), 'utf8');
const COMUN = fuente('comun.js');

/** Credenciales: las crea n8n/importar.sh con estos ids fijos, así los workflows quedan enlazados. */
export const CREDENCIALES = {
  postgres: { id: 'gastosPostgres01', name: 'Postgres Gastos (n8n)' },
  smtp: { id: 'gastosSmtp000001', name: 'SMTP Gastos' },
};

const uuid = (semilla) => {
  const h = createHash('sha256').update(semilla).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const idWorkflow = (semilla) => createHash('sha256').update(semilla).digest('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);

// Reserva el envío en notificaciones_log. ON CONFLICT DO UPDATE siempre devuelve la fila:
// si ya estaba «enviado», el mensaje se omite (idempotencia ante reintentos).
const SQL_RESERVAR = `WITH reserva AS (
  INSERT INTO notificaciones_log (clave_idempotencia, outbox_evento_id, transaccion_id, tipo, canal, destinatario, asunto, estado, intentos)
  VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::bigint, $4, $5::canal_notificacion, $6, $7, 'pendiente', 1)
  ON CONFLICT (clave_idempotencia) DO UPDATE SET intentos = notificaciones_log.intentos + 1
  RETURNING id, estado
)
SELECT id AS log_id, estado <> 'enviado' AS enviar FROM reserva`;

/** Construye un workflow a partir de nodos con posición en una cuadrícula y conexiones por nombre. */
function workflow(nombre, nodos, conexiones) {
  const connections = {};
  for (const [origen, salidas] of Object.entries(conexiones)) {
    connections[origen] = { main: salidas.map((destinos) => (destinos ?? []).map((node) => ({ node, type: 'main', index: 0 }))) };
  }
  return {
    id: idWorkflow(nombre),
    name: nombre,
    active: false,
    nodes: nodos.map(([name, type, typeVersion, [x, y], parameters, extra = {}]) => ({
      id: uuid(`${nombre}/${name}`), name, type, typeVersion, position: [x * 220, y * 160], parameters, ...extra,
    })),
    connections,
    settings: { executionOrder: 'v1', timezone: 'America/Bogota', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner' },
    pinData: {},
    tags: [],
    meta: { generadoPor: 'n8n/generar.mjs' },
  };
}

const codigo = (archivo) => `${COMUN}\n// ---------------------------------------------------------------------------\n${fuente(archivo)}`;
const pg = (consulta, parametros) => ({
  operation: 'executeQuery', query: consulta, options: { queryReplacement: `={{ ${parametros} }}` },
});

/** Bucle común: un mensaje a la vez → reservar → enviar por su canal → marcar. */
function nodosEnvio(x0) {
  return {
    nodos: [
      ['Uno por uno', 'n8n-nodes-base.splitInBatches', 3, [x0, 0], { batchSize: 1, options: {} }],
      ['¿Hay mensaje?', 'n8n-nodes-base.switch', 3.2, [x0 + 1, 1], { mode: 'expression', numberOutputs: 2, output: '={{ $json.vacio ? 1 : 0 }}' }],
      ['Reservar envío', 'n8n-nodes-base.postgres', 2.5, [x0 + 2, 1],
        pg(SQL_RESERVAR, '[$json.clave, $json.outbox_id, $json.transaccion_id, $json.tipo, $json.canal, $json.para, $json.asunto]'),
        { credentials: { postgres: CREDENCIALES.postgres } }],
      ['Combinar', 'n8n-nodes-base.code', 2, [x0 + 3, 1],
        { mode: 'runOnceForEachItem', jsCode: "return { json: { ...$('Uno por uno').item.json, ...$json } };" }],
      // Salidas: 0 correo · 1 Teams · 2 Slack · 3 WhatsApp · 4 ya enviado (se omite)
      ['Canal', 'n8n-nodes-base.switch', 3.2, [x0 + 4, 1],
        { mode: 'expression', numberOutputs: 5, output: "={{ $json.enviar ? ['correo', 'teams', 'slack', 'whatsapp'].indexOf($json.canal) : 4 }}" }],
      ['Enviar correo', 'n8n-nodes-base.emailSend', 2.1, [x0 + 5, 0],
        { fromEmail: '={{ $env.MAIL_FROM }}', toEmail: '={{ $json.para }}', subject: '={{ $json.asunto }}', emailFormat: 'html', html: '={{ $json.html }}', options: { appendAttribution: false } },
        { credentials: { smtp: CREDENCIALES.smtp } }],
      ['Marcar enviado', 'n8n-nodes-base.postgres', 2.5, [x0 + 6, 0],
        pg("UPDATE notificaciones_log SET estado = 'enviado', enviado_en = now(), error = NULL WHERE id = $1", "[$('Combinar').item.json.log_id]"),
        { credentials: { postgres: CREDENCIALES.postgres } }],
      // Punto de extensión: reemplazar estos nodos por Microsoft Teams, Slack o WhatsApp
      ['Teams (por configurar)', 'n8n-nodes-base.noOp', 1, [x0 + 5, 1], {}],
      ['Slack (por configurar)', 'n8n-nodes-base.noOp', 1, [x0 + 5, 2], {}],
      ['WhatsApp (por configurar)', 'n8n-nodes-base.noOp', 1, [x0 + 5, 3], {}],
      ['Marcar omitido', 'n8n-nodes-base.postgres', 2.5, [x0 + 6, 2],
        pg("UPDATE notificaciones_log SET estado = 'omitido', error = 'Canal sin configurar' WHERE id = $1", "[$('Combinar').item.json.log_id]"),
        { credentials: { postgres: CREDENCIALES.postgres } }],
    ],
    conexiones: {
      'Uno por uno': [null, ['¿Hay mensaje?']], // salida 0 = terminado; 1 = siguiente ítem
      '¿Hay mensaje?': [['Reservar envío'], ['Uno por uno']],
      'Reservar envío': [['Combinar']],
      Combinar: [['Canal']],
      Canal: [['Enviar correo'], ['Teams (por configurar)'], ['Slack (por configurar)'], ['WhatsApp (por configurar)'], ['Uno por uno']],
      'Enviar correo': [['Marcar enviado']],
      'Marcar enviado': [['Uno por uno']],
      'Teams (por configurar)': [['Marcar omitido']],
      'Slack (por configurar)': [['Marcar omitido']],
      'WhatsApp (por configurar)': [['Marcar omitido']],
      'Marcar omitido': [['Uno por uno']],
    },
  };
}

/** Workflow disparado por el relay de la API. Responde 200 solo si terminó de enviar todo. */
function workflowWebhook(nombre, ruta, archivo) {
  const envio = nodosEnvio(2);
  return workflow(nombre, [
    ['Evento del outbox', 'n8n-nodes-base.webhook', 2, [0, 0], { httpMethod: 'POST', path: ruta, responseMode: 'responseNode', options: {} },
      { webhookId: uuid(`webhook/${ruta}`) }],
    ['Preparar mensajes', 'n8n-nodes-base.code', 2, [1, 0], { jsCode: codigo(archivo) }],
    ...envio.nodos,
    ['Responder', 'n8n-nodes-base.respondToWebhook', 1.1, [3, -1], { respondWith: 'json', responseBody: '={{ { "ok": true } }}', options: {} }],
  ], {
    'Evento del outbox': [['Preparar mensajes']],
    'Preparar mensajes': [['Uno por uno']],
    ...envio.conexiones,
    'Uno por uno': [['Responder'], ['¿Hay mensaje?']],
  });
}

function workflowSla() {
  const envio = nodosEnvio(3);
  return workflow('Gastos 3 · Recordatorio diario de SLA y escalamiento', [
    // Lunes a viernes 7:00 (hora de Colombia); los festivos los filtra fn_hoy_es_habil()
    ['Cada día hábil 7:00', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * 1-5' }] } }],
    ['Gastos vencidos', 'n8n-nodes-base.postgres', 2.5, [1, 0],
      { operation: 'executeQuery', query: 'SELECT v.*, fn_hoy_es_habil() AS hoy_habil FROM v_sla_vencidas v ORDER BY v.dias_vencida DESC', options: {} },
      { credentials: { postgres: CREDENCIALES.postgres } }],
    ['Preparar recordatorios', 'n8n-nodes-base.code', 2, [2, 0], { jsCode: codigo('sla.js') }],
    ...envio.nodos,
    ['Fin', 'n8n-nodes-base.noOp', 1, [4, -1], {}],
  ], {
    'Cada día hábil 7:00': [['Gastos vencidos']],
    'Gastos vencidos': [['Preparar recordatorios']],
    'Preparar recordatorios': [['Uno por uno']],
    ...envio.conexiones,
    'Uno por uno': [['Fin'], ['¿Hay mensaje?']],
  });
}

export function generar() {
  return {
    '1-notificar-responsables.json': workflowWebhook('Gastos 1 · Notificar al equipo responsable', 'gastos-responsables', 'responsables.js'),
    '2-notificar-seguimiento.json': workflowWebhook('Gastos 2 · Notificar al solicitante y a contabilidad', 'gastos-seguimiento', 'seguimiento.js'),
    '3-recordatorio-sla.json': workflowSla(),
    '4-notificar-cierre.json': workflowWebhook('Gastos 4 · Notificar el cierre a los participantes', 'gastos-cierre', 'cierre.js'),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destino = path.join(DIR, 'workflows');
  fs.mkdirSync(destino, { recursive: true });
  for (const [archivo, wf] of Object.entries(generar())) {
    fs.writeFileSync(path.join(destino, archivo), `${JSON.stringify(wf, null, 2)}\n`);
    console.log(`✓ n8n/workflows/${archivo}  (${wf.nodes.length} nodos)`);
  }
}
