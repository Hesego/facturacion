import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construirApp } from '../src/app.js';
import { CLAVE_DEMO, llevarHasta, nueva, prepararContexto } from './ayudantes.js';

const ctx = prepararContexto();
let app: Awaited<ReturnType<typeof construirApp>>;
beforeAll(async () => {
  app = await construirApp({ config: { APP_URL: 'http://localhost:8080', SESION_HORAS: 1, COOKIE_SECURE: false, NODE_ENV: 'test' }, db: ctx.db, almacenamiento: ctx.almacenamiento });
});
afterAll(() => app.close());

async function sesion(email: string, password = CLAVE_DEMO) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  expect(r.statusCode, r.body).toBe(200);
  return { cookie: `gastos_sesion=${r.cookies[0]!.value}` };
}
let admin: { cookie: string };
const pedir = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object, s = admin) => app.inject({ method, url, payload, headers: s });
const etapa = async (codigo: string) => (await pedir('GET', '/api/admin/etapas')).json().find((e: any) => e.codigo === codigo);
/** Cuerpo de PUT /etapas/:id a partir de la fila actual, con cambios. */
const cuerpoEtapa = (e: any, cambios: object = {}) => ({
  codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion, grupo: e.grupo, orden: e.orden, tipo: e.tipo, equipoId: e.equipo_id,
  slaDias: e.sla_dias, etapaDevolucionId: e.etapa_devolucion_id, segregacion: e.segregacion,
  requisitos: e.requisitos, activa: e.activa, ...cambios,
});

beforeAll(async () => { admin = await sesion('admin@hesego.test'); });

describe('Acceso', () => {
  it('solo el equipo administrador entra a la administración', async () => {
    const r = await pedir('GET', '/api/admin/usuarios', undefined, await sesion('contabilidad1@hesego.test'));
    expect(r.statusCode).toBe(403);
    expect((await pedir('GET', '/api/admin/usuarios')).statusCode).toBe(200);
  });
});

describe('Usuarios', () => {
  it('crea un usuario con equipos y áreas, y puede iniciar sesión', async () => {
    const r = await pedir('POST', '/api/admin/usuarios', {
      email: 'Nuevo.Operador@Hesego.test', nombre: 'Operador Nuevo', password: 'ClaveSegura2026', equipos: ['operaciones'],
    });
    expect(r.statusCode, r.body).toBe(201);
    const s = await sesion('nuevo.operador@hesego.test', 'ClaveSegura2026');
    expect((await app.inject({ method: 'GET', url: '/api/auth/yo', headers: s })).json()).toMatchObject({ equipos: ['operaciones'] });

    expect((await pedir('POST', '/api/admin/usuarios', { email: 'nuevo.operador@hesego.test', nombre: 'Otro', password: 'ClaveSegura2026' })).json())
      .toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('Ya existe') });
    expect((await pedir('POST', '/api/admin/usuarios', { email: 'debil@hesego.test', nombre: 'Débil', password: 'corta' })).statusCode).toBe(422);
    expect((await pedir('POST', '/api/admin/usuarios', { email: 'x@hesego.test', nombre: 'Equipo inexistente', password: 'ClaveSegura2026', equipos: ['no_existe'] })).json())
      .toMatchObject({ mensaje: expect.stringContaining('no_existe') });
  });

  it('desactivar a un usuario cierra sus sesiones de inmediato', async () => {
    const usuarios = (await pedir('GET', '/api/admin/usuarios')).json();
    const u = usuarios.find((x: any) => x.email === 'nuevo.operador@hesego.test');
    const s = await sesion('nuevo.operador@hesego.test', 'ClaveSegura2026');
    expect((await pedir('PATCH', `/api/admin/usuarios/${u.id}`, { activo: false })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/yo', headers: s })).statusCode).toBe(401);
  });

  it('nadie se desactiva ni se quita a sí mismo del equipo administrador', async () => {
    const yo = (await app.inject({ method: 'GET', url: '/api/auth/yo', headers: admin })).json();
    expect((await pedir('PATCH', `/api/admin/usuarios/${yo.id}`, { activo: false })).statusCode).toBe(422);
    expect((await pedir('PATCH', `/api/admin/usuarios/${yo.id}`, { equipos: ['contabilidad'] })).statusCode).toBe(422);
  });

  it('no se desactiva a quien tiene gastos asignados: primero se reasignan', async () => {
    await nueva(ctx, { para: 'ops.inventario@hesego.test' });
    const u = (await pedir('GET', '/api/admin/usuarios')).json().find((x: any) => x.email === 'ops.inventario@hesego.test');
    expect(u.asignadas).toBeGreaterThan(0);
    expect((await pedir('PATCH', `/api/admin/usuarios/${u.id}`, { activo: false })).json())
      .toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('Reasígnalos') });
  });
});

describe('Áreas dentro de los equipos', () => {
  it('crea un área en un equipo; solo se asigna a usuarios de ese equipo', async () => {
    const equipos = (await pedir('GET', '/api/admin/equipos')).json();
    const compras = equipos.find((e: any) => e.codigo === 'compras');
    const r = await pedir('POST', '/api/admin/areas', { equipoId: compras.id, codigo: 'nacionales', nombre: 'Compras nacionales' });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ codigo: 'NACIONALES' });
    expect((await pedir('POST', '/api/admin/areas', { equipoId: compras.id, codigo: 'NACIONALES', nombre: 'Otra' })).statusCode).toBe(422);

    const usuarios = (await pedir('GET', '/api/admin/usuarios')).json();
    const comprador = usuarios.find((u: any) => u.email === 'compras1@hesego.test');
    const operador = usuarios.find((u: any) => u.email === 'ops.sst@hesego.test');
    expect((await pedir('PATCH', `/api/admin/usuarios/${comprador.id}`, { areas: [r.json().id] })).statusCode).toBe(200);
    expect((await pedir('PATCH', `/api/admin/usuarios/${operador.id}`, { areas: [...operador.areas, r.json().id] })).json())
      .toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('agrega primero al usuario a ese equipo') });
    // Se desactiva para no afectar el resto de pruebas (Compras vuelve a no tener áreas activas)
    expect((await pedir('PUT', `/api/admin/areas/${r.json().id}`, { equipoId: compras.id, codigo: 'NACIONALES', nombre: 'Compras nacionales', activa: false })).statusCode).toBe(200);
  });

  it('un área con gastos en curso no se desactiva', async () => {
    await nueva(ctx, { para: 'ops.tics@hesego.test' });
    const tics = (await pedir('GET', '/api/admin/areas')).json().find((a: any) => a.codigo === 'TICS' && a.equipo === 'Operaciones');
    expect(tics.en_curso).toBeGreaterThan(0);
    expect((await pedir('PUT', `/api/admin/areas/${tics.id}`, { equipoId: tics.equipo_id, codigo: 'TICS', nombre: tics.nombre, activa: false })).json())
      .toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('en curso') });
  });
});

describe('Etapas del flujo', () => {
  it('valida los requisitos contra el esquema', async () => {
    const ag = await etapa('AG');
    const r = await pedir('PUT', `/api/admin/etapas/${ag.id}`, cuerpoEtapa(ag, { requisitos: { firma_digital: true } }));
    expect(r.statusCode).toBe(422);
  });

  it('cambia el SLA de una etapa', async () => {
    const ag = await etapa('AG');
    try {
      expect((await pedir('PUT', `/api/admin/etapas/${ag.id}`, cuerpoEtapa(ag, { slaDias: 5 }))).statusCode).toBe(200);
      expect((await etapa('AG')).sla_dias).toBe(5);
    } finally {
      await pedir('PUT', `/api/admin/etapas/${ag.id}`, cuerpoEtapa(ag));
    }
  });

  it('no deja desactivar una etapa con gastos en curso', async () => {
    await nueva(ctx); // queda en RQ
    const rq = await etapa('RQ');
    expect((await pedir('PUT', `/api/admin/etapas/${rq.id}`, cuerpoEtapa(rq, { activa: false }))).json())
      .toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('gasto(s) en la etapa RQ') });
  });

  it('la devolución solo puede apuntar a una etapa anterior', async () => {
    const [oc, es] = [await etapa('OC'), await etapa('ES')];
    const r = await pedir('PUT', `/api/admin/etapas/${oc.id}`, cuerpoEtapa(oc, { etapaDevolucionId: es.id }));
    expect(r.json()).toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('etapa anterior') });
  });

  it('el cierre del sistema debe seguir siendo la última etapa', async () => {
    const ft = await etapa('FT');
    expect((await pedir('PUT', `/api/admin/etapas/${ft.id}`, cuerpoEtapa(ft, { orden: 5 }))).json())
      .toMatchObject({ mensaje: expect.stringContaining('única etapa del sistema') });
  });

  it('reordena en una sola operación, pero rechaza un orden que contradice las devoluciones', async () => {
    const activas = (await pedir('GET', '/api/admin/etapas')).json().filter((e: any) => e.activa);
    const ids = activas.map((e: any) => e.id);
    // Mismo orden: válido (las inactivas se corren al final sin chocar)
    expect((await pedir('POST', '/api/admin/etapas/orden', { ids })).statusCode).toBe(200);
    // AG devuelve a OC: poner AG antes de OC dejaría la devolución apuntando hacia adelante
    const iOC = activas.findIndex((e: any) => e.codigo === 'OC');
    const cambiado = [...ids];
    [cambiado[iOC], cambiado[iOC + 1]] = [cambiado[iOC + 1], cambiado[iOC]];
    expect((await pedir('POST', '/api/admin/etapas/orden', { ids: cambiado })).json())
      .toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.stringContaining('etapa anterior') });
    expect((await etapa('OC')).orden).toBeLessThan((await etapa('AG')).orden); // nada cambió
  });
});

describe('Configuración', () => {
  it('valida cada clave y no permite editar las fijas', async () => {
    expect((await pedir('PUT', '/api/admin/configuracion/semaforo', { valor: { amarillo: 2, naranja: 1 } })).json())
      .toMatchObject({ mensaje: expect.stringContaining('naranja debe ser mayor') });
    expect((await pedir('PUT', '/api/admin/configuracion/moneda', { valor: 'USD' })).statusCode).toBe(422);
    expect((await pedir('PUT', '/api/admin/configuracion/equipos_pueden_anular', { valor: ['contabilidad', 'inventado'] })).statusCode).toBe(422);
    try {
      expect((await pedir('PUT', '/api/admin/configuracion/escalamiento_dias_despues_de_vencer', { valor: 1 })).statusCode).toBe(200);
      const c = (await pedir('GET', '/api/admin/configuracion')).json().find((x: any) => x.clave === 'escalamiento_dias_despues_de_vencer');
      expect(c).toMatchObject({ valor: 1, editable: true });
    } finally {
      await pedir('PUT', '/api/admin/configuracion/escalamiento_dias_despues_de_vencer', { valor: 0 });
    }
  });
});

describe('Tablero', () => {
  it('cuenta por etapa y semáforo, y coincide con las transacciones en curso', async () => {
    await llevarHasta(ctx, (await nueva(ctx)).id, 'FT'); // al menos un gasto pagado
    const s = await sesion('gerencia1@hesego.test');
    const d = (await app.inject({ method: 'GET', url: '/api/tablero', headers: s })).json();
    expect(d.etapas.map((e: any) => e.codigo)).toEqual(['SOL', 'RQ', 'AP', 'OC', 'AG', 'ES', 'PG_ENV', 'PG_APR', 'RP']);
    const enCurso = await ctx.db.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).where('estado', '=', 'en_curso').executeTakeFirstOrThrow();
    expect(d.totales.en_curso).toBe(Number(enCurso.n));
    expect(d.etapas.reduce((s: number, e: any) => s + e.en_curso, 0)).toBe(Number(enCurso.n));
    for (const e of d.etapas) expect(e.en_curso).toBe(e.verde + e.amarillo + e.naranja + e.rojo);
    expect(d.etapas.find((e: any) => e.codigo === 'RQ').tramos).toBeGreaterThan(0);
    expect(d.totales.pagadas_180).toBeGreaterThan(0);
    expect(Array.isArray(d.atascadas)).toBe(true);
  });
});
