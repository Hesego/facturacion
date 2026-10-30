import { describe, expect, it } from 'vitest';
import { listarTransacciones } from '../src/dominio/consultas.js';
import { avanzar, devolver, reasignar } from '../src/dominio/flujo.js';
import { tablero } from '../src/dominio/tablero.js';
import { actor, codigoEtapa, idUsuario, leer, llevarHasta, numero, nueva, pdf, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();
const area = async (equipo: string, codigo: string) =>
  (await ctx.db.selectFrom('areas as a').innerJoin('equipos as e', 'e.id', 'a.equipo_id').select('a.id')
    .where('e.codigo', '=', equipo).where('a.codigo', '=', codigo).executeTakeFirstOrThrow()).id;
const enviarRQ = async (t: { id: number; version: number }, para: string, areaId?: number) =>
  avanzar(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id,
    { version: t.version, numero: numero('RQ'), asignarA: await idUsuario(ctx, para), areaId }, [pdf()]);

describe('Al enviar se elige el área del equipo siguiente y una persona de esa área', () => {
  it('la solicitud queda registrada con el área de operaciones de la persona elegida', async () => {
    const t = await nueva(ctx, { para: 'ops.tics@hesego.test' });
    expect(t.area_id).toBe(await area('operaciones', 'TICS'));
    const ev = await ctx.db.selectFrom('eventos').select('datos').where('transaccion_id', '=', t.id).where('tipo', '=', 'avanzada').executeTakeFirstOrThrow();
    expect(ev.datos).toMatchObject({ area: 'Tecnologías de la información', asignado: 'Natalia Gómez' });
  });

  it('con el área elegida explícitamente, la persona debe pertenecer a ella', async () => {
    const t = await nueva(ctx);
    await expect(enviarRQ(t, 'lider.sst@hesego.test', await area('lider_operaciones', 'TICS')))
      .rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS', message: expect.stringContaining('no pertenece al área') });
    await expect(enviarRQ(t, 'lider.sst@hesego.test', await area('operaciones', 'SST')))
      .rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS', message: expect.stringContaining('no es un área activa') });
    const ok = await enviarRQ(t, 'lider.sst@hesego.test', await area('lider_operaciones', 'SST'));
    expect(ok.area_id).toBe(await area('lider_operaciones', 'SST'));
  });

  it('si la persona está en varias áreas del equipo, hay que elegir cuál', async () => {
    const lider = await idUsuario(ctx, 'lider.sst@hesego.test');
    const tics = await area('lider_operaciones', 'TICS');
    await ctx.db.insertInto('usuario_area').values({ usuario_id: lider, area_id: tics }).execute();
    try {
      const t = await nueva(ctx);
      await expect(enviarRQ(t, 'lider.sst@hesego.test')).rejects.toMatchObject({ message: expect.stringContaining('Elige el área') });
      const ok = await enviarRQ(t, 'lider.sst@hesego.test', tics);
      expect(ok.area_id).toBe(tics);
    } finally {
      await ctx.db.deleteFrom('usuario_area').where('usuario_id', '=', lider).where('area_id', '=', tics).execute();
    }
  });

  it('a un equipo sin áreas (Compras) se envía directo a la persona, sin área', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'OC');
    expect(t.area_id).toBeNull();
    const lider = (await llevarHasta(ctx, (await nueva(ctx)).id, 'AP'));
    await expect(avanzar(ctx, await actor(ctx, 'lider.sst@hesego.test'), lider.id,
      { version: lider.version, comentario: 'Aprobado', asignarA: await idUsuario(ctx, 'compras1@hesego.test'), areaId: await area('operaciones', 'SST') }))
      .rejects.toMatchObject({ message: expect.stringContaining('no tiene áreas') });
  });

  it('una devolución vuelve al área en que estuvo; al reasignar cambia al área de la nueva persona', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP');
    const d = await devolver(ctx, await actor(ctx, 'lider.sst@hesego.test'), t.id, { version: t.version, motivo: 'Corregir el pantallazo' });
    expect(await codigoEtapa(ctx, d)).toBe('RQ');
    expect(d.area_id).toBe(await area('operaciones', 'SST'));
    const r = await reasignar(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id, { version: d.version, usuarioId: await idUsuario(ctx, 'ops.inventario@hesego.test') });
    expect(r.area_id).toBe(await area('operaciones', 'INVENTARIO'));
  });

  it('el listado filtra por área y el tablero cuenta por área', async () => {
    const t = await nueva(ctx, { para: 'ops.inventario@hesego.test' });
    const inv = await area('operaciones', 'INVENTARIO');
    const l = await listarTransacciones(ctx.db, { areaId: inv, pagina: 1, porPagina: 100 });
    expect(l.filas.map((f) => f.id)).toContain(t.id);
    expect(l.filas.every((f) => f.area_nombre === 'Inventario y almacén')).toBe(true);
    const d = await tablero(ctx.db);
    expect(d.areas.find((a) => a.area_id === inv)?.en_curso).toBeGreaterThan(0);
    expect((await leer(ctx, t.id)).area_id).toBe(inv);
  });
});
