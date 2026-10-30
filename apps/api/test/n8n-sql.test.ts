// Ejecuta las consultas de los nodos Postgres de los workflows de n8n contra el esquema real,
// con el rol restringido gastos_n8n. Si un workflow pide algo que n8n no puede hacer, falla aquí.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nueva, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();
// generar.mjs es JavaScript plano del paquete n8n/
const { generar } = (await import('../../../n8n/generar.mjs' as string)) as { generar: () => Record<string, any> };
const workflows = generar();
const consulta = (archivo: string, nodo: string): string => workflows[archivo].nodes.find((n: any) => n.name === nodo).parameters.query;
const RESERVAR = consulta('1-notificar-responsables.json', 'Reservar envío');
const MARCAR_ENVIADO = consulta('1-notificar-responsables.json', 'Marcar enviado');
const MARCAR_OMITIDO = consulta('1-notificar-responsables.json', 'Marcar omitido');
const VENCIDOS = consulta('3-recordatorio-sla.json', 'Gastos vencidos');

/** Ejecuta como n8n (rol gastos_n8n) con parámetros posicionales, como el nodo Postgres. */
async function comoN8n<T>(q: string, parametros: unknown[] = []): Promise<T[]> {
  if (!process.env.ROL_PRUEBAS) return (await ctx.db.executeQuery<T>({ sql: q, parameters: parametros, query: null as never } as never)).rows;
  await sql`SET ROLE gastos_n8n`.execute(ctx.db);
  try {
    return (await ctx.db.executeQuery<T>({ sql: q, parameters: parametros, query: null as never } as never)).rows;
  } finally {
    await sql.raw(`SET ROLE ${process.env.ROL_PRUEBAS}`).execute(ctx.db);
  }
}

let outboxId = '';
let transaccionId = '';
beforeAll(async () => {
  const t = await nueva(ctx);
  const o = await ctx.db.selectFrom('outbox_eventos').select('id').where('transaccion_id', '=', t.id).executeTakeFirstOrThrow();
  outboxId = o.id;
  transaccionId = String(t.id);
});
afterAll(() => sql`RESET ROLE`.execute(ctx.db).catch(() => undefined));

describe('Consultas de n8n contra la base de datos', () => {
  it('reservar es idempotente: tras marcar enviado, un reintento no vuelve a enviar', async () => {
    const p = [`${outboxId}:responsables:correo:ops.sst@hesego.test`, outboxId, transaccionId, 'nueva_etapa', 'correo', 'ops.sst@hesego.test', 'Asunto, con coma'];
    const [primera] = await comoN8n<{ log_id: number; enviar: boolean }>(RESERVAR, p);
    expect(primera).toMatchObject({ enviar: true });

    const [reintentoAntes] = await comoN8n<{ log_id: number; enviar: boolean }>(RESERVAR, p);
    expect(reintentoAntes).toEqual({ log_id: primera!.log_id, enviar: true }); // no se había enviado: se reintenta

    await comoN8n(MARCAR_ENVIADO, [primera!.log_id]);
    const [reintentoDespues] = await comoN8n<{ log_id: number; enviar: boolean }>(RESERVAR, p);
    expect(reintentoDespues).toEqual({ log_id: primera!.log_id, enviar: false });

    const log = await sql<any>`SELECT estado, intentos, enviado_en, transaccion_id, outbox_evento_id FROM notificaciones_log WHERE id = ${primera!.log_id}`.execute(ctx.db);
    expect(log.rows[0]).toMatchObject({ estado: 'enviado', intentos: 3, transaccion_id: Number(transaccionId), outbox_evento_id: outboxId });
  });

  it('los recordatorios de SLA no llevan transacción ni outbox', async () => {
    const [r] = await comoN8n<{ log_id: number; enviar: boolean }>(RESERVAR, ['sla:2026-10-29:recordatorio:correo:x@hesego.test', '', '', 'sla_recordatorio', 'correo', 'x@hesego.test', 'Recordatorio']);
    expect(r!.enviar).toBe(true);
    await comoN8n(MARCAR_OMITIDO, [r!.log_id]);
  });

  it('lee la vista de vencidos con el indicador de día hábil', async () => {
    const filas = await comoN8n<{ hoy_habil: boolean; responsables: unknown }>(VENCIDOS);
    expect(Array.isArray(filas)).toBe(true);
    if (filas.length) expect(typeof filas[0]!.hoy_habil).toBe('boolean');
  });

  it('n8n no puede leer transacciones ni el outbox directamente', async () => {
    await expect(comoN8n('SELECT * FROM transacciones LIMIT 1')).rejects.toThrow(/permission denied/);
    await expect(comoN8n('SELECT * FROM outbox_eventos LIMIT 1')).rejects.toThrow(/permission denied/);
  });
});
