// Workflow 1 · Avisar SOLO al destinatario del paso: la persona a la que se le asignó la transacción
// (avance, devolución o reasignación) o la que la tenía pendiente cuando se anuló. Nunca a equipos completos.
const entrada = $input.first().json;
validarToken(entrada);
const e = entrada.body;
const t = e.transaccion;
const responsables = unicos(e.destinatarios.responsables);
if (!responsables.length) return sinMensajes(); // p. ej. la etapa de cierre la ejecuta el sistema

if (e.tipo === 'transaccion.anulada') {
  const html = correo({
    kicker: `${t.consecutivo} · Anulado`,
    titulo: 'Gasto anulado',
    intro: `<b>${escapar(e.actor.nombre)}</b> anuló la transacción que tenías en <b>${escapar(e.etapa_origen.nombre)}</b>. Ya no tienes que hacer nada con ella.`,
    cita: e.motivo,
    citaEtiqueta: `Motivo de ${e.actor.nombre}`,
    filas: filasGasto(t),
    tabla: tablaObservaciones(e.observaciones),
    boton: { texto: 'Ver la transacción', url: t.url },
    nota: `Si respondes este correo, la respuesta le llega a ${escapar(e.actor.nombre)}.`,
  });
  return mensajes(responsables, { flujo: 'responsables', outboxId: e.outbox_id, transaccionId: t.id, tipo: 'anulacion', asunto: asuntoGasto(t, 'Anulado'), html, actor: e.actor });
}

const reasignada = e.tipo === 'transaccion.reasignada';
const devuelta = e.tipo === 'transaccion.devuelta';
const destino = e.etapa_destino;
const sla = destino.sla_dias === 1 ? '1 día hábil' : `${destino.sla_dias} días hábiles`;
// El asunto es el que escribió el solicitante; en devolución y reasignación se antepone qué pasó
const asunto = asuntoGasto(t, reasignada ? 'Reasignado' : devuelta ? 'Devuelto' : '');

const html = correo({
  kicker: `${t.consecutivo} · ${destino.codigo}`,
  titulo: reasignada ? 'Te asignaron un gasto' : devuelta ? 'Te devolvieron un gasto' : 'Tienes un gasto por atender',
  intro: reasignada
    ? `<b>${escapar(e.actor.nombre)}</b> te asignó la transacción, que está en <b>${escapar(destino.nombre)}</b>. El plazo de la etapa sigue corriendo.`
    : devuelta
      ? `<b>${escapar(e.actor.nombre)}</b> devolvió la transacción desde <b>${escapar(e.etapa_origen.nombre)}</b> a <b>${escapar(destino.nombre)}</b>. Revisa el motivo, corrige y vuelve a enviarla.`
      : `<b>${escapar(e.actor.nombre)}</b> completó <b>${escapar(e.etapa_origen.nombre)}</b> y te la envió. Te corresponde la etapa <b>${escapar(destino.nombre)}</b>. El plazo es de ${sla}.`,
  cita: reasignada || devuelta ? e.motivo : e.comentario,
  citaEtiqueta: `${reasignada || devuelta ? 'Motivo' : 'Observación'} de ${e.actor.nombre}`,
  filas: filasGasto(t),
  tabla: tablaObservaciones(e.observaciones),
  boton: { texto: 'Revisar la solicitud', url: t.url },
  nota: `Si respondes este correo, la respuesta le llega a ${escapar(e.actor.nombre)}.`,
});

return mensajes(responsables, { flujo: 'responsables', outboxId: e.outbox_id, transaccionId: t.id, tipo: reasignada ? 'reasignacion' : devuelta ? 'devolucion' : 'nueva_etapa', asunto, html, actor: e.actor });
