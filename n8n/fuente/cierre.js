// Workflow 4 · Cierre (FT): avisar al solicitante que el gasto quedó pagado.
const entrada = $input.first().json;
validarToken(entrada);
const e = entrada.body;
const t = e.transaccion;
const personas = unicos(e.destinatarios.responsables);
if (!personas.length) return sinMensajes();

const html = correo({
  kicker: `${t.consecutivo} · Cierre`,
  titulo: 'Pagado y cerrado',
  intro: 'El gasto que solicitaste completó todo el flujo y quedó <b>pagado</b>.',
  filas: filasGasto(t),
  boton: { texto: 'Ver el historial', url: t.url },
  nota: 'Recibes este aviso porque solicitaste este gasto.',
});

return mensajes(personas, { flujo: 'cierre', outboxId: e.outbox_id, transaccionId: t.id, tipo: 'cierre', asunto: asuntoGasto(t, 'Pagado y cerrado'), html });
