// Workflow 1 · Avisar a la persona a la que se le asignó la transacción (avance, devolución o reasignación).
const entrada = $input.first().json;
validarToken(entrada);
const e = entrada.body;
const t = e.transaccion;
const responsables = unicos(e.destinatarios.responsables);
if (!responsables.length) return sinMensajes(); // p. ej. la etapa de cierre la ejecuta el sistema

const reasignada = e.tipo === 'transaccion.reasignada';
const devuelta = e.tipo === 'transaccion.devuelta';
const destino = e.etapa_destino;
const sla = destino.sla_dias === 1 ? '1 día hábil' : `${destino.sla_dias} días hábiles`;
const asunto = reasignada
  ? `[${t.consecutivo}] Te asignaron un gasto en ${destino.nombre}`
  : devuelta
    ? `[${t.consecutivo}] Te devolvieron un gasto a ${destino.nombre}`
    : `[${t.consecutivo}] Tienes un gasto en ${destino.nombre}`;

const html = correo({
  kicker: `${t.consecutivo} · ${destino.codigo}`,
  titulo: reasignada ? 'Te asignaron un gasto' : devuelta ? 'Te devolvieron un gasto' : 'Tienes un gasto por atender',
  intro: reasignada
    ? `<b>${escapar(e.actor.nombre)}</b> te asignó la transacción, que está en <b>${escapar(destino.nombre)}</b>. El plazo de la etapa sigue corriendo.`
    : devuelta
      ? `<b>${escapar(e.actor.nombre)}</b> devolvió la transacción desde <b>${escapar(e.etapa_origen.nombre)}</b> a <b>${escapar(destino.nombre)}</b>. Revisa el motivo, corrige y vuelve a enviarla.`
      : `<b>${escapar(e.actor.nombre)}</b> completó <b>${escapar(e.etapa_origen.nombre)}</b> y te la envió. Te corresponde la etapa <b>${escapar(destino.nombre)}</b>. El plazo es de ${sla}.`,
  cita: reasignada || devuelta ? e.motivo : e.comentario,
  citaEtiqueta: reasignada || devuelta ? 'Motivo' : 'Comentario',
  filas: filasGasto(t),
  boton: { texto: 'Abrir la transacción', url: t.url },
});

return mensajes(responsables, { flujo: 'responsables', outboxId: e.outbox_id, transaccionId: t.id, tipo: reasignada ? 'reasignacion' : devuelta ? 'devolucion' : 'nueva_etapa', asunto, html });
