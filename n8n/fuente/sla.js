// Workflow 3 · Recordatorio diario de gastos con el SLA vencido y escalamiento al líder.
// Un solo correo por persona con todos sus gastos vencidos (no uno por transacción).
// Las filas vienen de la vista v_sla_vencidas: quién responde y a quién escalar lo decide la base de datos.
const filas = $input.all().map((i) => i.json);
if (!filas.length || !filas[0].hoy_habil) return []; // fin de semana o festivo: no se recuerda

const fecha = hoy();
const porPersona = { recordatorio: new Map(), escalamiento: new Map() };
const agregar = (tipo, persona, fila) => {
  if (!persona || !persona.email) return;
  const clave = String(persona.email).toLowerCase();
  const g = porPersona[tipo].get(clave) || { persona, filas: [] };
  g.filas.push(fila);
  porPersona[tipo].set(clave, g);
};
for (const f of filas) {
  for (const r of f.responsables || []) agregar('recordatorio', r, f);
  if (f.escalar && f.escalar_a) agregar('escalamiento', f.escalar_a, f);
}

const tabla = (lista) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${['Transacción', 'Etapa', 'Días hábiles', 'Valor'].map((h) => `<th align="left" style="padding:8px 6px;border-bottom:2px solid #E2EAED;font:700 11px/1.3 Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#4E646E">${h}</th>`).join('')}</tr>
    ${lista
      .sort((a, b) => b.dias_vencida - a.dias_vencida)
      .map((f) => `<tr>
        <td style="padding:10px 6px;border-bottom:1px solid #E2EAED;font:15px/1.4 Arial,sans-serif;color:#14313B">
          <a href="${escapar(`${APP_URL}/transacciones/${f.transaccion_id}`)}" style="color:#0A7D8C;font-weight:700;text-decoration:none">${escapar(f.consecutivo)}</a>
          <div style="font-size:13px;color:#4E646E">${escapar([f.facturas && `Factura ${f.facturas}`, f.area_nombre, f.descripcion].filter(Boolean).join(' · '))}</div></td>
        <td style="padding:10px 6px;border-bottom:1px solid #E2EAED;font:14px/1.4 Arial,sans-serif;color:#14313B">${escapar(f.etapa_nombre)}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #E2EAED;font:700 14px/1.4 Arial,sans-serif;color:#B45309">${f.dias_habiles_en_etapa} (plazo ${f.sla_dias})</td>
        <td style="padding:10px 6px;border-bottom:1px solid #E2EAED;font:14px/1.4 Arial,sans-serif;color:#14313B;white-space:nowrap">${f.valor ? escapar(formatearCOP(f.valor)) : '—'}</td>
      </tr>`).join('')}
  </table>`;

const salida = [];
for (const [tipo, grupos] of Object.entries(porPersona)) {
  for (const { persona, filas: lista } of grupos.values()) {
    const n = lista.length;
    const escalamiento = tipo === 'escalamiento';
    const asunto = escalamiento
      ? `Escalamiento: ${n} ${n === 1 ? 'gasto vencido' : 'gastos vencidos'} de tu equipo`
      : `Tienes ${n} ${n === 1 ? 'gasto' : 'gastos'} con el plazo vencido`;
    const html = correo({
      kicker: escalamiento ? 'Escalamiento de SLA' : 'Recordatorio de SLA',
      titulo: escalamiento ? 'Gastos vencidos en tu equipo' : 'Gastos con el plazo vencido',
      intro: escalamiento
        ? `Estos gastos superaron el plazo de su etapa y te los escalamos como líder. Te pedimos ayudar a destrabarlos hoy.`
        : `Estos gastos esperan a tu equipo y ya superaron el plazo de su etapa. Atiéndelos hoy para no frenar el pago al proveedor.`,
      tabla: tabla(lista),
      boton: { texto: 'Ir a mis pendientes', url: `${APP_URL}/` },
      nota: 'Los plazos se cuentan en días hábiles, sin fines de semana ni festivos de Colombia.',
    });
    salida.push(...mensajes([persona], { flujo: tipo, claveBase: `sla:${fecha}`, tipo: `sla_${tipo}`, asunto, html }));
  }
}
return salida;
