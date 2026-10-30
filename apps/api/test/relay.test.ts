import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { esperaReintento, RelayOutbox } from '../src/servicios/relay-outbox.js';
import { llevarHasta, nueva, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();
const TOKEN = 'token-de-prueba-123';

/** n8n simulado: registra lo que recibe y responde con el código que se le indique. */
const recibidos: { ruta: string; token: string | undefined; cuerpo: any }[] = [];
let responder = (_ruta: string) => 200;
let servidor: http.Server;
let base = '';

beforeAll(async () => {
  servidor = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let datos = '';
    for await (const c of req) datos += c;
    const ruta = req.url!.replace(/^\/webhook\//, '');
    recibidos.push({ ruta, token: req.headers['x-webhook-token'] as string, cuerpo: JSON.parse(datos) });
    const codigo = responder(ruta);
    res.writeHead(codigo).end(codigo === 200 ? '{"ok":true}' : 'falla simulada');
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/webhook`;
  // Lo que dejaron otros archivos de prueba no interesa aquí
  await sql`UPDATE outbox_eventos SET estado = 'enviado', procesado_en = now() WHERE estado = 'pendiente'`.execute(ctx.db);
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
beforeEach(() => { recibidos.length = 0; responder = () => 200; });

const relay = (o: Partial<ConstructorParameters<typeof RelayOutbox>[1]> = {}) =>
  new RelayOutbox(ctx.db, { baseUrl: base, token: TOKEN, ...o });
const outbox = (transaccionId: number) =>
  ctx.db.selectFrom('outbox_eventos').select(['id', 'tipo', 'estado', 'intentos', 'ultimo_error', 'procesado_en', 'proximo_intento'])
    .where('transaccion_id', '=', transaccionId).orderBy('creado_en').execute();

describe('Relay del outbox hacia n8n', () => {
  it('entrega cada evento a sus webhooks con el token y lo marca como enviado', async () => {
    const t = await nueva(ctx);
    expect(await relay().procesarLote()).toBe(1);

    expect(recibidos.map((r) => r.ruta)).toEqual(['gastos-responsables', 'gastos-seguimiento']);
    expect(recibidos.every((r) => r.token === TOKEN)).toBe(true);
    const [o] = await outbox(t.id);
    expect(recibidos[0]!.cuerpo).toMatchObject({ outbox_id: o!.id, tipo: 'transaccion.avanzada', transaccion: { consecutivo: t.consecutivo } });
    expect(o).toMatchObject({ estado: 'enviado', intentos: 1, ultimo_error: null });
    expect(o!.procesado_en).not.toBeNull();
  });

  it('el cierre va solo al workflow de cierre', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'FT');
    await relay({ lote: 50 }).procesarLote();
    const cierre = recibidos.filter((r) => r.cuerpo.transaccion.id === t.id && r.cuerpo.tipo === 'transaccion.cerrada');
    expect(cierre.map((r) => r.ruta)).toEqual(['gastos-cierre']);
  });

  it('si n8n falla, reintenta más tarde sin perder el evento', async () => {
    const t = await nueva(ctx);
    responder = (ruta) => (ruta === 'gastos-seguimiento' ? 500 : 200);
    await relay().procesarLote();

    const [o] = await outbox(t.id);
    expect(o).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(o!.ultimo_error).toContain('gastos-seguimiento respondió 500');
    expect(new Date(o!.proximo_intento).getTime()).toBeGreaterThan(Date.now() + 20_000); // espera 30 s

    // No se vuelve a tomar antes de tiempo
    recibidos.length = 0;
    await relay().procesarLote();
    expect(recibidos).toHaveLength(0);

    // Cuando llega su hora y n8n responde, se entrega (n8n deduplica lo que ya había enviado)
    await sql`UPDATE outbox_eventos SET proximo_intento = now() WHERE id = ${o!.id}::uuid`.execute(ctx.db);
    responder = () => 200;
    await relay().procesarLote();
    expect((await outbox(t.id))[0]).toMatchObject({ estado: 'enviado', intentos: 2 });
  });

  it('tras el máximo de intentos queda como fallido para revisión', async () => {
    const t = await nueva(ctx);
    responder = () => 503;
    const r = relay({ maxIntentos: 2 });
    await r.procesarLote();
    await sql`UPDATE outbox_eventos SET proximo_intento = now() WHERE transaccion_id = ${t.id}`.execute(ctx.db);
    await r.procesarLote();
    expect((await outbox(t.id))[0]).toMatchObject({ estado: 'fallido', intentos: 2 });
  });

  it('si n8n no responde, cuenta como falla', async () => {
    const t = await nueva(ctx);
    await relay({ baseUrl: 'http://127.0.0.1:1/webhook' }).procesarLote();
    expect((await outbox(t.id))[0]).toMatchObject({ estado: 'pendiente', intentos: 1 });
  });

  it('dos relays a la vez no entregan el mismo evento dos veces', async () => {
    const t = await nueva(ctx);
    await Promise.all([relay().procesarLote(), relay().procesarLote()]);
    expect(recibidos.filter((r) => r.cuerpo.transaccion.id === t.id)).toHaveLength(2); // 2 webhooks, una sola vez
  });

  it('la espera entre reintentos crece y tiene tope de una hora', () => {
    expect([1, 2, 3, 4, 10, 20].map(esperaReintento)).toEqual([30, 60, 120, 240, 3600, 3600]);
  });
});
