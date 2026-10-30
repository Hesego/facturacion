import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { anular, devolver, reasignar } from '../src/dominio/flujo.js';
import { comentar } from '../src/dominio/soportes.js';
import { actor, idUsuario, llevarHasta, nueva, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();
const ultimoOutbox = async (id: number, tipo: string) =>
  (await ctx.db.selectFrom('outbox_eventos').select('payload').where('transaccion_id', '=', id).where('tipo', '=', tipo)
    .orderBy('creado_en', 'desc').executeTakeFirstOrThrow()).payload as any;

describe('Historial de solo inserción (regla 8)', () => {
  it('la aplicación no puede editar ni borrar eventos ni comentarios', async () => {
    const t = await nueva(ctx);
    await comentar(ctx, await actor(ctx, 'contabilidad1@hesego.test'), t.id, 'Pendiente confirmar con el proveedor');
    await expect(ctx.db.updateTable('eventos').set({ motivo: 'alterado' }).where('transaccion_id', '=', t.id).execute()).rejects.toThrow();
    await expect(ctx.db.deleteFrom('eventos').where('transaccion_id', '=', t.id).execute()).rejects.toThrow();
    await expect(ctx.db.updateTable('comentarios').set({ texto: 'alterado' }).where('transaccion_id', '=', t.id).execute()).rejects.toThrow();
    await expect(ctx.db.deleteFrom('transacciones').where('id', '=', t.id).execute()).rejects.toThrow();
  });
});

describe('Atomicidad (regla 7)', () => {
  it('la base de datos rechaza cambiar la etapa o el responsable sin evento ni outbox, aunque se salte la API', async () => {
    const t = await nueva(ctx);
    const ap = await ctx.db.selectFrom('catalogo_etapas').select('id').where('codigo', '=', 'AP').executeTakeFirstOrThrow();
    await expect(ctx.db.updateTable('transacciones').set({ etapa_actual_id: ap.id }).where('id', '=', t.id).execute())
      .rejects.toThrow(/sin evento de auditoría y outbox/);
    await expect(ctx.db.updateTable('transacciones').set({ asignado_a: await idUsuario(ctx, 'ops.tics@hesego.test') }).where('id', '=', t.id).execute())
      .rejects.toThrow(/sin evento de auditoría y outbox/);
  });

  it('si algo falla a mitad de la transición no queda evento, outbox ni cambio de estado', async () => {
    const t = await nueva(ctx);
    const contar = async () => (await ctx.db.selectFrom('eventos').select(sql<number>`count(*)::int`.as('n')).where('transaccion_id', '=', t.id).executeTakeFirstOrThrow()).n;
    const antes = await contar();
    await expect(ctx.db.transaction().execute(async (trx) => {
      const ev = await trx.insertInto('eventos').values({ transaccion_id: t.id, tipo: 'avanzada', etapa_origen_id: t.etapa_actual_id,
        etapa_destino_id: t.etapa_actual_id, actor_id: t.solicitante_id, datos: '{}' }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('outbox_eventos').values({ evento_id: ev.id, transaccion_id: t.id, tipo: 'transaccion.avanzada', payload: '{}' }).execute();
      throw new Error('falla simulada antes de actualizar la transacción');
    })).rejects.toThrow('falla simulada');
    expect(await contar()).toBe(antes);
  });
});

describe('Outbox para n8n', () => {
  it('al enviar, avisa solo a la persona elegida y hace seguimiento sin quien hizo el cambio', async () => {
    const t = await nueva(ctx, { numero: 'OB-100', para: 'ops.tics@hesego.test', descripcion: 'Radios para supervisores' });
    const p = await ultimoOutbox(t.id, 'transaccion.avanzada');
    expect(p.transaccion).toMatchObject({ consecutivo: t.consecutivo, facturas: ['OB-100'], descripcion: 'Radios para supervisores',
      asignado: 'Natalia Gómez', url: `http://localhost:8080/transacciones/${t.id}` });
    expect(p.transaccion.valor_formateado).toMatch(/1\.500\.000/);
    expect(p.etapa_destino).toMatchObject({ codigo: 'RQ', sla_dias: 3 });
    expect(p.destinatarios.responsables.map((r: any) => r.email)).toEqual(['ops.tics@hesego.test']);
    const seguimiento = p.destinatarios.seguimiento.map((r: any) => r.email);
    expect(seguimiento).toContain('contabilidad2@hesego.test');
    expect(seguimiento).not.toContain('contabilidad1@hesego.test'); // es quien envió
  });

  it('la devolución avisa a quien la recibe de vuelta, con el motivo; la reasignación, a la nueva persona', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP');
    const d = await devolver(ctx, await actor(ctx, 'lider.sst@hesego.test'), t.id, { version: t.version, motivo: 'El pantallazo no es legible' });
    const p = await ultimoOutbox(t.id, 'transaccion.devuelta');
    expect(p.motivo).toBe('El pantallazo no es legible');
    expect(p.destinatarios.responsables.map((r: any) => r.email)).toEqual(['ops.sst@hesego.test']);

    await reasignar(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id, { version: d.version, usuarioId: await idUsuario(ctx, 'ops.inventario@hesego.test'), motivo: 'Vacaciones' });
    const r = await ultimoOutbox(t.id, 'transaccion.reasignada');
    expect(r.destinatarios.responsables.map((x: any) => x.email)).toEqual(['ops.inventario@hesego.test']);
    expect(r.motivo).toBe('Vacaciones');
  });

  it('el cierre y la anulación incluyen a todos los participantes', async () => {
    const pagada = await llevarHasta(ctx, (await nueva(ctx)).id, 'FT');
    const cierre = await ultimoOutbox(pagada.id, 'transaccion.cerrada');
    expect(cierre.destinatarios.participantes.map((r: any) => r.email).sort()).toEqual([
      'compras1@hesego.test', 'contabilidad1@hesego.test', 'contabilidad2@hesego.test', 'gerencia1@hesego.test',
      'gfinanciera1@hesego.test', 'lider.sst@hesego.test', 'ops.sst@hesego.test',
    ]);
    expect(cierre.destinatarios.responsables).toEqual([]);

    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP');
    await anular(ctx, await actor(ctx, 'contabilidad2@hesego.test'), t.id, { version: t.version, motivo: 'Cambio de proveedor' });
    const an = await ultimoOutbox(t.id, 'transaccion.anulada');
    expect(an.destinatarios.participantes.map((r: any) => r.email)).toEqual(expect.arrayContaining(['ops.sst@hesego.test', 'contabilidad1@hesego.test']));
  });
});
