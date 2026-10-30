// Workflow 2 · Avisar al solicitante y a contabilidad (dueña del proceso) de cada cambio relevante.
const entrada = $input.first().json;
validarToken(entrada);
const e = entrada.body;
const t = e.transaccion;
const anulada = e.tipo === 'transaccion.anulada';
const devuelta = e.tipo === 'transaccion.devuelta';

// El paso a la etapa de cierre lo notifica el workflow 4 (cierre) a todos los participantes
if (e.tipo === 'transaccion.avanzada' && !e.destinatarios.responsables.length) return sinMensajes();

// En una anulación también se avisa a todos los que participaron
const personas = unicos([...e.destinatarios.seguimiento, ...(anulada ? e.destinatarios.participantes : [])], e.actor && e.actor.email);
if (!personas.length) return sinMensajes();

const actor = `<b>${escapar(e.actor.nombre)}</b>`;
let asunto, titulo, intro;
if (anulada) {
  asunto = asuntoGasto(t, 'Anulado');
  titulo = 'Gasto anulado';
  intro = `${actor} anuló la transacción cuando estaba en <b>${escapar(e.etapa_origen.nombre)}</b>. Sus facturas y números de referencia quedaron liberados.`;
} else if (devuelta) {
  asunto = asuntoGasto(t, `Devuelto a ${e.etapa_destino.nombre}`);
  titulo = 'Gasto devuelto';
  intro = `${actor} devolvió la transacción desde <b>${escapar(e.etapa_origen.nombre)}</b> a <b>${escapar(e.etapa_destino.nombre)}</b>${t.asignado ? `, a cargo de <b>${escapar(t.asignado)}</b>` : ''}.`;
} else {
  asunto = asuntoGasto(t, `Avanzó a ${e.etapa_destino.nombre}`);
  titulo = 'Avance del gasto';
  intro = `${actor} completó <b>${escapar(e.etapa_origen.nombre)}</b>. La transacción pasó a <b>${escapar(e.etapa_destino.nombre)}</b>${t.asignado ? `, a cargo de <b>${escapar(t.asignado)}</b>` : ''}.`;
}

const html = correo({
  kicker: `${t.consecutivo} · Seguimiento`,
  titulo,
  intro,
  cita: anulada || devuelta ? e.motivo : e.comentario,
  citaEtiqueta: anulada || devuelta ? 'Motivo' : 'Comentario',
  filas: filasGasto(t),
  boton: { texto: 'Ver la transacción', url: t.url },
  nota: 'Recibes este aviso porque solicitaste el gasto o perteneces a contabilidad, dueña del proceso.',
});

return mensajes(personas, { flujo: 'seguimiento', outboxId: e.outbox_id, transaccionId: t.id, tipo: anulada ? 'anulacion' : 'seguimiento', asunto, html, actor: e.actor });
