// ---------------------------------------------------------------------------
// Funciones comunes de los workflows de notificación (las inyecta n8n/generar.mjs en cada
// nodo Code). n8n NO decide nada del negocio: los destinatarios ya vienen resueltos por la API
// o por la vista v_sla_vencidas. Aquí solo se arma el mensaje.
// ---------------------------------------------------------------------------

const APP_URL = String($env.APP_URL || '').replace(/\/$/, '');

/** Cuenta que envía (Gmail solo deja enviar desde la cuenta autenticada): la de MAIL_FROM o SMTP_USER. */
const CORREO_ENVIO = (String($env.MAIL_FROM || '').match(/<([^>]+)>/) || [])[1] || String($env.MAIL_FROM || '').trim() || String($env.SMTP_USER || '');

/** Canales activos. Para sumar Teams, Slack o WhatsApp: agréguelo aquí y configure su rama en el nodo «Canal». */
const CANALES = ['correo'];

const ZONA = 'America/Bogota';
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const formatearCOP = (v) => cop.format(Number(v));
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Rechaza llamadas sin el token compartido con la API. */
function validarToken(entrada) {
  const token = entrada.headers && entrada.headers['x-webhook-token'];
  if (!$env.N8N_WEBHOOK_TOKEN || token !== $env.N8N_WEBHOOK_TOKEN) {
    throw new Error('Token de webhook inválido');
  }
}

/**
 * Remitente visible. Con actor, el correo muestra su nombre («Pepito Pérez vía Gastos Hesego»)
 * aunque lo envíe la cuenta de la plataforma; las respuestas le llegan a él (Reply-To).
 */
function remitente(actor) {
  const nombre = actor && actor.nombre ? `${actor.nombre} vía Gastos Hesego` : 'Gastos Hesego';
  return `"${nombre.replace(/[<>"]/g, '')}" <${CORREO_ENVIO}>`;
}

/** Asunto del correo: el que escribió el solicitante (descripción), con el consecutivo para buscarlo. */
function asuntoGasto(t, prefijo) {
  const base = t.descripcion ? `${t.descripcion} [${t.consecutivo}]` : `Gasto ${t.consecutivo}`;
  return prefijo ? `${prefijo}: ${base}` : base;
}

/** Personas únicas por correo, sin la que se indique (quien hizo el cambio). */
function unicos(personas, excluirEmail) {
  const vistos = new Set();
  const excluir = String(excluirEmail || '').toLowerCase();
  return (personas || []).filter((p) => {
    const e = String(p && p.email || '').toLowerCase();
    if (!e || e === excluir || vistos.has(e)) return false;
    vistos.add(e);
    return true;
  });
}

/**
 * Correo con el sistema visual Hesego (Manual de Marca v1.1). En correo no se pueden incrustar
 * las fuentes: se usan las sustitutas de la lámina 13 (Arial Black y Arial).
 */
function correo({ kicker, titulo, intro, filas = [], cita, citaEtiqueta, tabla, boton, nota }) {
  const fila = ([k, v]) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #E2EAED;font:700 11px/1.4 Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#4E646E;width:140px;vertical-align:top">${escapar(k)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #E2EAED;font:15px/1.5 Arial,sans-serif;color:#14313B">${escapar(v)}</td>
    </tr>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(titulo)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F7;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E2EAED;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0E4A57;background-image:linear-gradient(160deg,#0E4A57,#0A343E);padding:24px 32px">
    <div style="font:700 11px/1 Arial,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#6FD9E6">Hesego Ingeniería S.A.S.</div>
    <div style="margin-top:8px;font:900 20px/1 'Arial Black',Arial,sans-serif;text-transform:uppercase;color:#FFFFFF">Flujo de gastos</div>
  </td></tr>
  <tr><td style="padding:32px 32px 8px">
    <div style="font:700 12px/1 Arial,sans-serif;letter-spacing:2.5px;text-transform:uppercase;color:#0A7D8C">${escapar(kicker)}</div>
    <h1 style="margin:10px 0 0;font:900 26px/1.1 'Arial Black',Arial,sans-serif;text-transform:uppercase;color:#14313B">${escapar(titulo)}</h1>
    <div style="margin-top:14px;width:160px;height:6px;border-radius:3px;background:#FF6B1A;background-image:linear-gradient(90deg,#FF6B1A,#00AEC6)"></div>
    <p style="margin:18px 0 0;font:16px/1.6 Arial,sans-serif;color:#3B565F">${intro}</p>
  </td></tr>
  ${cita ? `<tr><td style="padding:16px 32px 0">
    <div style="border-left:4px solid #0A7D8C;background:#F1F5F7;border-radius:8px;padding:12px 16px">
      ${citaEtiqueta ? `<div style="font:700 11px/1 Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#4E646E;margin-bottom:6px">${escapar(citaEtiqueta)}</div>` : ''}
      <div style="font:15px/1.5 Arial,sans-serif;color:#14313B">${escapar(cita)}</div>
    </div></td></tr>` : ''}
  ${filas.length ? `<tr><td style="padding:16px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas.map(fila).join('')}</table></td></tr>` : ''}
  ${tabla ? `<tr><td style="padding:16px 32px 0">${tabla}</td></tr>` : ''}
  ${boton ? `<tr><td style="padding:24px 32px 0">
    <a href="${escapar(boton.url)}" style="display:inline-block;background:#0A7D8C;color:#FFFFFF;text-decoration:none;font:700 16px/1 Arial,sans-serif;padding:14px 24px;border-radius:10px">${escapar(boton.texto)}</a>
  </td></tr>` : ''}
  <tr><td style="padding:28px 32px 28px">
    ${nota ? `<p style="margin:0 0 14px;font:14px/1.5 Arial,sans-serif;color:#4E646E">${nota}</p>` : ''}
    <div style="border-top:1px solid #E2EAED;padding-top:16px;font:700 11px/1.4 Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#0A7D8C">Trabajamos de manera segura, confiable y diligente.</div>
    <div style="margin-top:6px;font:12px/1.5 Arial,sans-serif;color:#4E646E">Mensaje automático de la plataforma de gastos.</div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Datos del gasto que se repiten en los correos (solo lo que se registra aquí: control, no contabilidad). */
function filasGasto(t) {
  return [
    ['Factura', (t.facturas || []).join(', ') || '—'],
    ...(t.area ? [['Área', t.area]] : []),
    ...(t.proveedor ? [['Proveedor', t.proveedor]] : []),
    ...(t.valor_formateado ? [['Valor', t.valor_formateado]] : []),
    ...(t.descripcion ? [['Descripción', t.descripcion]] : []),
    ['Solicitante', t.solicitante],
  ];
}

const fechaHora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Historial de observaciones de los pasos anteriores (sin la última, que va destacada arriba).
 * Es la trazabilidad: quién escribió qué, en qué etapa y cuándo.
 */
function tablaObservaciones(observaciones) {
  const previas = (observaciones || []).slice(0, -1);
  if (!previas.length) return '';
  const etiqueta = { devuelta: 'Devolución', reasignada: 'Reasignación', anulada: 'Anulación', comentario: 'Comentario' };
  const filas = previas.map((o) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #E2EAED">
      <div style="font:700 11px/1.4 Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#4E646E">${escapar(o.actor || 'Sistema')} · ${escapar(o.etapa || '')}${etiqueta[o.tipo] ? ` · ${etiqueta[o.tipo]}` : ''} · ${escapar(fechaHora.format(new Date(o.fecha)))}</div>
      <div style="margin-top:4px;font:15px/1.5 Arial,sans-serif;color:#14313B">${escapar(o.texto)}</div>
    </td></tr>`).join('');
  return `<div style="font:700 12px/1 Arial,sans-serif;letter-spacing:2.5px;text-transform:uppercase;color:#0A7D8C;margin:8px 0 4px">Observaciones anteriores</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>`;
}

/**
 * Un mensaje por destinatario y canal. La clave de idempotencia evita enviarlo dos veces aunque
 * el evento llegue repetido (reintentos del relay).
 */
function mensajes(personas, { flujo, outboxId, transaccionId, tipo, asunto, html, claveBase, actor }) {
  const salida = [];
  for (const p of personas) {
    for (const canal of CANALES) {
      salida.push({
        json: {
          clave: `${claveBase || outboxId}:${flujo}:${canal}:${String(p.email).toLowerCase()}`,
          outbox_id: outboxId || '',
          transaccion_id: transaccionId ? String(transaccionId) : '',
          tipo,
          canal,
          para: p.email,
          nombre: p.nombre,
          asunto,
          html,
          de: remitente(actor),
          responder_a: (actor && actor.email) || '',
        },
      });
    }
  }
  return salida;
}

/** Sin destinatarios: un único ítem vacío para que el webhook responda igual. */
const sinMensajes = () => [{ json: { vacio: true } }];
