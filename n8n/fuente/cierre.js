// Workflow 4 · Cierre (FT): avisar a todos los que participaron en la transacción.
const entrada = $input.first().json;
validarToken(entrada);
const e = entrada.body;
const t = e.transaccion;
const personas = unicos(e.destinatarios.participantes);
if (!personas.length) return sinMensajes();

const html = correo({
  kicker: `${t.consecutivo} · Cierre`,
  titulo: 'Pagado y cerrado',
  intro: 'El gasto completó todo el flujo y quedó <b>pagado</b>. Gracias por tu parte en el proceso.',
  filas: filasGasto(t),
  boton: { texto: 'Ver el historial', url: t.url },
  nota: 'Recibes este aviso porque participaste en alguna etapa de esta transacción.',
});

return mensajes(personas, { flujo: 'cierre', outboxId: e.outbox_id, transaccionId: t.id, tipo: 'cierre', asunto: `[${t.consecutivo}] Gasto pagado y cerrado`, html });
