import { describe, expect, it } from 'vitest';
import { anular, avanzar, devolver, reasignar } from '../src/dominio/flujo.js';
import { pendientes } from '../src/dominio/consultas.js';
import { actor, codigoEtapa, completarEtapa, idUsuario, leer, llevarHasta, numero, nueva, pdf, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();
const ORDEN = ['RQ', 'AP', 'OC', 'AG', 'ES', 'PG_ENV', 'PG_APR', 'RP', 'FT'];

describe('Camino feliz', () => {
  it('la solicitud se crea y se envía en un paso; luego recorre todo el flujo en orden y cierra como pagada', async () => {
    const t = await nueva(ctx);
    expect(t.consecutivo).toMatch(/^GTO-\d{4}-\d{6}$/);
    expect(await codigoEtapa(ctx, t)).toBe('RQ');
    expect(t.asignado_a).toBe(await idUsuario(ctx, 'ops.sst@hesego.test'));

    const recorrido = ['RQ'];
    for (let i = 0; i < ORDEN.length - 1; i++) recorrido.push(await codigoEtapa(ctx, await completarEtapa(ctx, t.id)));
    expect(recorrido).toEqual(ORDEN);

    const final = await leer(ctx, t.id);
    expect(final).toMatchObject({ estado: 'pagada', asignado_a: null });
    const eventos = await ctx.db.selectFrom('eventos').select('tipo').where('transaccion_id', '=', t.id)
      .where('tipo', 'in', ['creada', 'avanzada', 'cerrada']).orderBy('id').execute();
    expect(eventos.map((e) => e.tipo)).toEqual(['creada', ...Array(9).fill('avanzada'), 'cerrada']);
    const outbox = await ctx.db.selectFrom('outbox_eventos').select('tipo').where('transaccion_id', '=', t.id).orderBy('creado_en').execute();
    expect(outbox.map((o) => o.tipo)).toEqual([...Array(9).fill('transaccion.avanzada'), 'transaccion.cerrada']);
  });

  it('cada transacción aparece solo en los pendientes de la persona asignada', async () => {
    const t = await nueva(ctx, { para: 'ops.tics@hesego.test' });
    expect((await pendientes(ctx.db, await actor(ctx, 'ops.tics@hesego.test'))).map((p) => p.id)).toContain(t.id);
    expect((await pendientes(ctx.db, await actor(ctx, 'ops.sst@hesego.test'))).map((p) => p.id)).not.toContain(t.id);
  });

  it('la aprobación registra la decisión, el comentario y a quién se envió', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP');
    await avanzar(ctx, await actor(ctx, 'lider.sst@hesego.test'), t.id,
      { version: t.version, comentario: 'Conforme con el RQ', asignarA: await idUsuario(ctx, 'compras1@hesego.test') });
    const ev = await ctx.db.selectFrom('eventos').select('datos').where('transaccion_id', '=', t.id).where('tipo', '=', 'avanzada')
      .orderBy('id', 'desc').limit(1).executeTakeFirstOrThrow();
    expect(ev.datos).toMatchObject({ decision: 'aprobado', comentario: 'Conforme con el RQ', asignado: 'Diego Castro' });
  });
});

describe('Transiciones inválidas', () => {
  it('no avanza sin el número y el documento que pide la etapa', async () => {
    const t = await nueva(ctx);
    const ops = await actor(ctx, 'ops.sst@hesego.test');
    const lider = await idUsuario(ctx, 'lider.sst@hesego.test');
    const intento = avanzar(ctx, ops, t.id, { version: t.version, asignarA: lider });
    await expect(intento).rejects.toMatchObject({
      codigo: 'REQUISITOS_INCOMPLETOS',
      detalles: expect.arrayContaining([
        expect.objectContaining({ clave: 'referencia:RQ', cumple: false }),
        expect.objectContaining({ clave: 'adjunto:pantallazo_operacion', cumple: false }),
      ]),
    });
    await expect(avanzar(ctx, ops, t.id, { version: t.version, asignarA: lider, numero: numero('RQ') }))
      .rejects.toMatchObject({ codigo: 'REQUISITOS_INCOMPLETOS' });
    // Nada quedó a medias: el número no se guardó porque la transición falló
    expect(await ctx.db.selectFrom('referencias').select('id').where('transaccion_id', '=', t.id).execute()).toHaveLength(0);
    expect(await codigoEtapa(ctx, await leer(ctx, t.id))).toBe('RQ');
  });

  it('una etapa acepta varios documentos y soportes adicionales en el mismo envío', async () => {
    const t = await nueva(ctx);
    const r = await avanzar(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id,
      { version: t.version, numero: numero('RQ'), asignarA: await idUsuario(ctx, 'lider.sst@hesego.test') },
      [pdf('pantallazo-1.pdf'), pdf('pantallazo-2.pdf')], [pdf('correo-del-proveedor.pdf')]);
    expect(await codigoEtapa(ctx, r)).toBe('AP');
    const adjuntos = await ctx.db.selectFrom('adjuntos').select(['tipo', 'nombre_original']).where('transaccion_id', '=', t.id)
      .where('tipo', '!=', 'factura').orderBy('id').execute();
    expect(adjuntos).toEqual([
      { tipo: 'pantallazo_operacion', nombre_original: 'pantallazo-1.pdf' },
      { tipo: 'pantallazo_operacion', nombre_original: 'pantallazo-2.pdf' },
      { tipo: 'soporte_adicional', nombre_original: 'correo-del-proveedor.pdf' },
    ]);
  });

  it('hay que elegir a quién se envía, y debe ser del equipo de la etapa siguiente', async () => {
    const t = await nueva(ctx);
    const ops = await actor(ctx, 'ops.sst@hesego.test');
    const base = { version: t.version, numero: numero('RQ') };
    await expect(avanzar(ctx, ops, t.id, base, [pdf()])).rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS', message: expect.stringContaining('Elige a la persona') });
    await expect(avanzar(ctx, ops, t.id, { ...base, asignarA: await idUsuario(ctx, 'compras1@hesego.test') }, [pdf()]))
      .rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS', message: expect.stringContaining('Líderes de operaciones') });
  });

  it('una aprobación exige comentario', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AG');
    await expect(avanzar(ctx, await actor(ctx, 'gerencia1@hesego.test'), t.id, { version: t.version, asignarA: await idUsuario(ctx, 'ops.sst@hesego.test') }))
      .rejects.toMatchObject({ codigo: 'REQUISITOS_INCOMPLETOS', detalles: [expect.objectContaining({ clave: 'comentario' })] });
  });

  it('rechaza la acción si la transacción cambió desde que el usuario la vio, y de dos clics simultáneos solo uno pasa', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP');
    const lider = await actor(ctx, 'lider.sst@hesego.test');
    const datos = { version: t.version, comentario: 'Aprobado', asignarA: await idUsuario(ctx, 'compras1@hesego.test') };
    const r = await Promise.allSettled([avanzar(ctx, lider, t.id, datos), avanzar(ctx, lider, t.id, datos)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: { codigo: 'VERSION_DESACTUALIZADA' } });
    expect(await codigoEtapa(ctx, await leer(ctx, t.id))).toBe('OC');
  });

  it('una transacción pagada no admite más acciones', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'FT');
    const contab = await actor(ctx, 'contabilidad1@hesego.test');
    await expect(avanzar(ctx, contab, t.id, { version: t.version })).rejects.toMatchObject({ codigo: 'TRANSACCION_CERRADA' });
    await expect(anular(ctx, contab, t.id, { version: t.version, motivo: 'Ya no se necesita' })).rejects.toMatchObject({ codigo: 'TRANSACCION_CERRADA' });
  });
});

describe('Devoluciones', () => {
  it('el rechazo vuelve a la persona que envió la etapa anterior, que la reenvía sin volver a cargar nada', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx, { para: 'ops.tics@hesego.test' })).id, 'AP');
    const r = await devolver(ctx, await actor(ctx, 'lider.sst@hesego.test'), t.id, { version: t.version, motivo: 'El pantallazo no es legible' });
    expect(await codigoEtapa(ctx, r)).toBe('RQ');
    expect(r.asignado_a).toBe(await idUsuario(ctx, 'ops.tics@hesego.test'));
    const ev = await ctx.db.selectFrom('eventos').select(['motivo', 'datos']).where('transaccion_id', '=', t.id).where('tipo', '=', 'devuelta').executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ motivo: 'El pantallazo no es legible', datos: { decision: 'rechazado', asignado: 'Natalia Gómez' } });

    // El número y el documento siguen ahí: basta con reenviar
    const otraVez = await avanzar(ctx, await actor(ctx, 'ops.tics@hesego.test'), t.id, { version: r.version, asignarA: await idUsuario(ctx, 'lider.tics@hesego.test') });
    expect(await codigoEtapa(ctx, otraVez)).toBe('AP');
  });

  it('operaciones devuelve la solicitud a contabilidad; la primera etapa no admite devolución', async () => {
    const t = await nueva(ctx);
    const r = await devolver(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id, { version: t.version, motivo: 'No corresponde a operaciones' });
    expect(await codigoEtapa(ctx, r)).toBe('SOL');
    expect(r.asignado_a).toBe(await idUsuario(ctx, 'contabilidad1@hesego.test'));
    await expect(devolver(ctx, await actor(ctx, 'contabilidad1@hesego.test'), t.id, { version: r.version, motivo: 'No aplica aquí' }))
      .rejects.toMatchObject({ codigo: 'DEVOLUCION_NO_PERMITIDA' });
    const reenviada = await completarEtapa(ctx, t.id, { RQ: 'ops.inventario@hesego.test' });
    expect(reenviada.asignado_a).toBe(await idUsuario(ctx, 'ops.inventario@hesego.test'));
  });
});

describe('Reasignación (vacaciones, ausencias)', () => {
  it('la persona asignada la pasa a un compañero de su equipo; el SLA no se reinicia', async () => {
    const t = await nueva(ctx);
    const r = await reasignar(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id,
      { version: t.version, usuarioId: await idUsuario(ctx, 'ops.inventario@hesego.test'), motivo: 'Vacaciones' });
    expect(r.asignado_a).toBe(await idUsuario(ctx, 'ops.inventario@hesego.test'));
    expect(r.en_etapa_desde).toEqual(t.en_etapa_desde);
    expect(await codigoEtapa(ctx, r)).toBe('RQ');
    const o = await ctx.db.selectFrom('outbox_eventos').select('tipo').where('transaccion_id', '=', t.id).orderBy('creado_en', 'desc').executeTakeFirstOrThrow();
    expect(o.tipo).toBe('transaccion.reasignada');
    // Quien la tenía ya no puede actuar
    await expect(avanzar(ctx, await actor(ctx, 'ops.sst@hesego.test'), t.id, { version: r.version })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
  });

  it('contabilidad puede reasignar; otro equipo no; y solo a miembros del equipo de la etapa', async () => {
    const t = await nueva(ctx);
    await expect(reasignar(ctx, await actor(ctx, 'compras1@hesego.test'), t.id, { version: t.version, usuarioId: await idUsuario(ctx, 'ops.tics@hesego.test') }))
      .rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(reasignar(ctx, await actor(ctx, 'contabilidad2@hesego.test'), t.id, { version: t.version, usuarioId: await idUsuario(ctx, 'compras1@hesego.test') }))
      .rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS' });
    const r = await reasignar(ctx, await actor(ctx, 'contabilidad2@hesego.test'), t.id, { version: t.version, usuarioId: await idUsuario(ctx, 'ops.tics@hesego.test') });
    expect(r.asignado_a).toBe(await idUsuario(ctx, 'ops.tics@hesego.test'));
  });
});

describe('Anulación', () => {
  it('contabilidad y el administrador anulan con motivo; quedan cerradas y sin asignado', async () => {
    for (const email of ['contabilidad2@hesego.test', 'admin@hesego.test']) {
      const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'OC');
      const r = await anular(ctx, await actor(ctx, email), t.id, { version: t.version, motivo: 'El proveedor no puede prestar el servicio' });
      expect(r).toMatchObject({ estado: 'anulada', asignado_a: null });
    }
  });

  it('al anular se liberan los números de referencia para reutilizarlos', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP');
    const rq = await ctx.db.selectFrom('referencias').select('numero').where('transaccion_id', '=', t.id).where('tipo', '=', 'RQ').executeTakeFirstOrThrow();
    await anular(ctx, await actor(ctx, 'contabilidad1@hesego.test'), t.id, { version: t.version, motivo: 'RQ asignado a otro gasto' });
    const otra = await nueva(ctx);
    const r = await avanzar(ctx, await actor(ctx, 'ops.sst@hesego.test'), otra.id,
      { version: otra.version, numero: rq.numero, asignarA: await idUsuario(ctx, 'lider.sst@hesego.test') }, [pdf()]);
    expect(await codigoEtapa(ctx, r)).toBe('AP');
  });
});

describe('El flujo sale del catálogo, no del código', () => {
  it('una etapa nueva insertada en el catálogo se recorre sin cambiar código', async () => {
    const equipo = await ctx.db.selectFrom('equipos').select('id').where('codigo', '=', 'compras').executeTakeFirstOrThrow();
    const ag = await ctx.db.selectFrom('catalogo_etapas').select('id').where('codigo', '=', 'AG').executeTakeFirstOrThrow();
    await ctx.db.insertInto('catalogo_etapas').values({
      codigo: 'VB', grupo: 'VB', orden: 55, nombre: 'Visto bueno de compras', tipo: 'ejecucion', equipo_id: equipo.id,
      etapa_devolucion_id: ag.id, requisitos: JSON.stringify({ comentario_obligatorio: true }),
    }).execute();
    try {
      const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AG');
      const gerencia = await actor(ctx, 'gerencia1@hesego.test');
      const enVB = await avanzar(ctx, gerencia, t.id, { version: t.version, comentario: 'OC aprobada', asignarA: await idUsuario(ctx, 'compras1@hesego.test') });
      expect(await codigoEtapa(ctx, enVB)).toBe('VB');
      const compras = await actor(ctx, 'compras1@hesego.test');
      const ops = await idUsuario(ctx, 'ops.sst@hesego.test');
      await expect(avanzar(ctx, compras, t.id, { version: enVB.version, asignarA: ops })).rejects.toMatchObject({ codigo: 'REQUISITOS_INCOMPLETOS' });
      const despues = await avanzar(ctx, compras, t.id, { version: enVB.version, comentario: 'Visto bueno', asignarA: ops });
      expect(await codigoEtapa(ctx, despues)).toBe('ES');
    } finally {
      await ctx.db.updateTable('catalogo_etapas').set({ activa: false, orden: 9055 }).where('codigo', '=', 'VB').execute();
    }
  });
});
