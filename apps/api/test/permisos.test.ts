import { describe, expect, it } from 'vitest';
import { anular, avanzar, crearSolicitud, devolver, reasignar } from '../src/dominio/flujo.js';
import { registrarAdjuntos } from '../src/dominio/soportes.js';
import { actor, completarEtapa, idUsuario, llevarHasta, numero, nueva, pdf, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();

describe('Solo la persona asignada actúa', () => {
  it('solo contabilidad crea solicitudes, y solo puede enviarlas a operaciones', async () => {
    const datos = { asignarA: await idUsuario(ctx, 'ops.sst@hesego.test') };
    const factura = () => [{ numero: numero('FE'), archivos: [pdf()] }];
    await expect(crearSolicitud(ctx, await actor(ctx, 'ops.sst@hesego.test'), datos, factura())).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(crearSolicitud(ctx, await actor(ctx, 'admin@hesego.test'), datos, factura())).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(crearSolicitud(ctx, await actor(ctx, 'contabilidad1@hesego.test'), { ...datos, asignarA: await idUsuario(ctx, 'gerencia1@hesego.test') }, factura()))
      .rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS' });
  });

  it('otra persona del mismo equipo no puede actuar sobre una transacción que no tiene asignada', async () => {
    const t = await nueva(ctx); // asignada a ops.sst
    const otro = await actor(ctx, 'ops.tics@hesego.test');
    await expect(avanzar(ctx, otro, t.id, { version: t.version })).rejects.toMatchObject({
      codigo: 'SIN_PERMISO', message: expect.stringContaining('asignada a Julián Ortiz'),
    });
    await expect(devolver(ctx, otro, t.id, { version: t.version, motivo: 'No me corresponde' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(registrarAdjuntos(ctx, otro, t.id, [pdf()])).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
  });

  it('el líder que no fue elegido no aprueba el RQ', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AP', { AP: 'lider.tics@hesego.test' });
    const datos = { version: t.version, comentario: 'Aprobado', asignarA: await idUsuario(ctx, 'compras1@hesego.test') };
    await expect(avanzar(ctx, await actor(ctx, 'lider.sst@hesego.test'), t.id, datos)).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    const ok = await avanzar(ctx, await actor(ctx, 'lider.tics@hesego.test'), t.id, datos);
    expect(ok.version).toBe(t.version + 1);
  });

  it('el administrador no ejecuta etapas', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'OC');
    await expect(avanzar(ctx, await actor(ctx, 'admin@hesego.test'), t.id, { version: t.version })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
  });

  it('solo contabilidad o administrador anulan (regla 6)', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'AG');
    for (const email of ['ops.sst@hesego.test', 'gerencia1@hesego.test', 'gfinanciera1@hesego.test', 'compras1@hesego.test']) {
      await expect(anular(ctx, await actor(ctx, email), t.id, { version: t.version, motivo: 'No debería poder' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    }
  });
});

describe('Segregación de funciones (regla 5)', () => {
  it('quien envía una aprobación no puede elegirse a sí mismo como aprobador', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'PG_ENV', { PG_ENV: 'doble.rol@hesego.test' });
    const doble = await actor(ctx, 'doble.rol@hesego.test');
    await expect(avanzar(ctx, doble, t.id, { version: t.version, comentario: 'Listo para revisión', asignarA: doble.id })).rejects.toMatchObject({ codigo: 'SEGREGACION' });
    const ok = await avanzar(ctx, doble, t.id, { version: t.version, comentario: 'Listo para revisión', asignarA: await idUsuario(ctx, 'gfinanciera1@hesego.test') });
    expect(ok.version).toBe(t.version + 1);
  });

  it('tampoco se le puede reasignar la aprobación a quien envió la etapa anterior', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'PG_APR', { PG_ENV: 'doble.rol@hesego.test' }); // doble.rol envió PG_ENV
    await expect(reasignar(ctx, await actor(ctx, 'gfinanciera1@hesego.test'), t.id, { version: t.version, usuarioId: await idUsuario(ctx, 'doble.rol@hesego.test') }))
      .rejects.toMatchObject({ codigo: 'SEGREGACION' });
  });

  it('si otra persona envió el pago, el usuario con doble rol sí puede aprobarlo', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'PG_APR', { PG_APR: 'doble.rol@hesego.test' }); // envió contabilidad1
    const r = await avanzar(ctx, await actor(ctx, 'doble.rol@hesego.test'), t.id,
      { version: t.version, comentario: 'Aprobado', asignarA: await idUsuario(ctx, 'contabilidad2@hesego.test') });
    expect(r.version).toBe(t.version + 1);
    await completarEtapa(ctx, t.id);
  });
});
