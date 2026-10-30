import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construirApp } from '../src/app.js';
import { archivoXml, CLAVE_DEMO, idUsuario, nueva, pdf, prepararContexto, zipFactura } from './ayudantes.js';

const ctx = prepararContexto();
let app: Awaited<ReturnType<typeof construirApp>>;

beforeAll(async () => {
  app = await construirApp({
    config: { APP_URL: 'http://localhost:8080', SESION_HORAS: 1, COOKIE_SECURE: false, NODE_ENV: 'test' },
    db: ctx.db,
    almacenamiento: ctx.almacenamiento,
  });
});
afterAll(() => app.close());

// El login admite 10 intentos por minuto por IP: se reutiliza una sesión por usuario
const sesiones = new Map<string, { cookie: string }>();
async function sesion(email: string) {
  if (!sesiones.has(email)) sesiones.set(email, await iniciar(email));
  return sesiones.get(email)!;
}
async function iniciar(email: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: CLAVE_DEMO } });
  expect(r.statusCode).toBe(200);
  const c = r.cookies.find((x) => x.name === 'gastos_sesion')!;
  expect(c.httpOnly).toBe(true);
  expect(c.sameSite).toBe('Strict');
  return { cookie: `gastos_sesion=${c.value}` };
}

type Archivo = { nombre: string; mime: string; contenido: Buffer; campo?: string };
/** Cuerpo multipart con campos y uno o varios archivos. */
function formulario(campos: Record<string, string | number>, archivos: Archivo[]) {
  const limite = `----limite${randomUUID()}`;
  const partes: Buffer[] = Object.entries(campos).map(([k, v]) =>
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const a of archivos) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${a.campo ?? 'archivos'}"; filename="${a.nombre}"\r\nContent-Type: ${a.mime}\r\n\r\n`), a.contenido, Buffer.from('\r\n'));
  }
  partes.push(Buffer.from(`--${limite}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${limite}` } };
}
const enviar = async (url: string, s: { cookie: string }, campos: Record<string, string | number>, archivos: Archivo[]) => {
  const f = formulario(campos, archivos);
  return app.inject({ method: 'POST', url, payload: f.payload, headers: { ...s, ...f.headers } });
};

describe('Autenticación', () => {
  it('rechaza credenciales inválidas con un mensaje que no revela si el correo existe', async () => {
    for (const email of ['contabilidad1@hesego.test', 'no.existe@hesego.test']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'incorrecta' } });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ codigo: 'NO_AUTENTICADO', mensaje: 'Correo o contraseña incorrectos' });
    }
  });

  it('sin sesión no hay acceso; con sesión devuelve el usuario con sus equipos', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/pendientes' })).statusCode).toBe(401);
    const yo = await app.inject({ method: 'GET', url: '/api/auth/yo', headers: await sesion('ops.tics@hesego.test') });
    expect(yo.json()).toMatchObject({ email: 'ops.tics@hesego.test', equipos: ['operaciones'] });
  });

  it('cerrar sesión invalida la cookie', async () => {
    const s = await iniciar('compras1@hesego.test');
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: s });
    expect((await app.inject({ method: 'GET', url: '/api/auth/yo', headers: s })).statusCode).toBe(401);
  });
});

describe('Flujo por HTTP', () => {
  it('nueva solicitud: solo el ZIP de la DIAN, el número sale solo, y se envía a la persona elegida', async () => {
    const contab = await sesion('contabilidad1@hesego.test');
    const cat = (await app.inject({ method: 'GET', url: '/api/catalogos', headers: contab })).json();
    const rq = cat.etapas.find((e: any) => e.codigo === 'RQ');
    expect(rq.miembros.map((m: any) => m.email)).toEqual(expect.arrayContaining(['ops.sst@hesego.test', 'ops.tics@hesego.test']));

    const para = await idUsuario(ctx, 'ops.tics@hesego.test');
    const r = await enviar('/api/transacciones', contab, { asignarA: para, descripcion: 'Licencias de ofimática' }, [zipFactura({ numero: 'TIC-4410', valor: '3200000.50' })]);
    expect(r.statusCode, r.body).toBe(201);
    const t = r.json();
    expect(t).toMatchObject({ valor: '3200000.50', asignado_a: para });

    const pend = (await app.inject({ method: 'GET', url: '/api/pendientes', headers: await sesion('ops.tics@hesego.test') })).json();
    expect(pend.find((p: any) => p.id === t.id)).toMatchObject({ etapa_codigo: 'RQ', facturas: 'TIC-4410', semaforo: 'verde', dias_habiles_en_etapa: 0 });
    const otro = (await app.inject({ method: 'GET', url: '/api/pendientes', headers: await sesion('ops.sst@hesego.test') })).json();
    expect(otro.map((p: any) => p.id)).not.toContain(t.id);
  });

  it('varias facturas y un pantallazo en el mismo formulario (factura_<i>, numero_<i>, soporte)', async () => {
    const contab = await sesion('contabilidad1@hesego.test');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
    const r = await enviar('/api/transacciones', contab, { asignarA: await idUsuario(ctx, 'ops.sst@hesego.test'), numero_0: 'HT-1', numero_1: 'HT-2' }, [
      { ...pdf('HT-1.pdf'), campo: 'factura_0' },
      { ...pdf('HT-2.pdf'), campo: 'factura_1' },
      { nombre: 'pantallazo.png', mime: 'image/png', contenido: png, campo: 'soporte' },
    ]);
    expect(r.statusCode, r.body).toBe(201);
    const d = (await app.inject({ method: 'GET', url: `/api/transacciones/${r.json().id}`, headers: contab })).json();
    expect(d.facturas.map((f: any) => f.numero)).toEqual(['HT-1', 'HT-2']);
    expect(d.adjuntos.filter((a: any) => a.tipo === 'soporte_adicional').map((a: any) => a.nombre_original)).toEqual(['pantallazo.png']);
  });

  it('el detalle dice qué falta, a quién se puede enviar y qué puede hacer cada usuario', async () => {
    const t = await nueva(ctx);
    const d = (await app.inject({ method: 'GET', url: `/api/transacciones/${t.id}`, headers: await sesion('ops.sst@hesego.test') })).json();
    expect(d.etapa).toMatchObject({ codigo: 'RQ', referencia: { tipo: 'RQ' }, documentos: [expect.objectContaining({ tipo: 'pantallazo_operacion' })] });
    expect(d.siguiente).toMatchObject({ codigo: 'AP' });
    expect(d.transaccion.asignado.nombre).toBe('Julián Ortiz');
    expect(d.transaccion.area.nombre).toBe('Seguridad y salud en el trabajo');
    expect(d.acciones).toMatchObject({ avanzar: true, devolver: true, anular: false, reasignar: true, etiquetaAvanzar: 'Enviar',
      devolverA: { etapa: 'Solicitud de gasto', persona: 'Carolina Ruiz' } });
    // Líderes de operaciones tiene áreas: primero el área, luego la persona
    expect(d.acciones.destino.areas.map((a: any) => [a.codigo, a.miembros.map((m: any) => m.email)])).toEqual([
      ['INVENTARIO', ['lider.inventario@hesego.test']], ['SST', ['lider.sst@hesego.test']], ['TICS', ['lider.tics@hesego.test']],
    ]);
    expect(d.requisitos.map((r: any) => [r.clave, r.cumple])).toEqual([['referencia:RQ', false], ['adjunto:pantallazo_operacion', false]]);

    const contab = (await app.inject({ method: 'GET', url: `/api/transacciones/${t.id}`, headers: await sesion('contabilidad1@hesego.test') })).json();
    expect(contab.acciones).toMatchObject({ avanzar: false, devolver: false, anular: true, registrarFacturas: true, reasignar: true });
  });

  it('completar la etapa en un solo envío: número + documento + siguiente persona', async () => {
    const t = await nueva(ctx);
    const s = await sesion('ops.sst@hesego.test');
    const contenido = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await enviar(`/api/transacciones/${t.id}/avanzar`, s,
      { version: t.version, numero: 'RQ-88001', asignarA: await idUsuario(ctx, 'lider.sst@hesego.test') },
      [{ nombre: 'operación ñ.png', mime: 'image/png', contenido }]);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().asignado_a).toBe(await idUsuario(ctx, 'lider.sst@hesego.test'));

    const d = (await app.inject({ method: 'GET', url: `/api/transacciones/${t.id}`, headers: s })).json();
    const a = d.adjuntos.find((x: any) => x.tipo === 'pantallazo_operacion');
    expect(a).toMatchObject({ nombre_original: 'operación ñ.png', etapa_codigo: 'RQ' });
    expect(d.referencias.map((x: any) => x.numero)).toContain('RQ-88001');

    const desc = await app.inject({ method: 'GET', url: `/api/adjuntos/${a.id}/descarga`, headers: s });
    expect(desc.rawPayload).toEqual(contenido);
    expect(desc.headers['content-disposition']).toContain("filename*=UTF-8''operaci%C3%B3n%20%C3%B1.png");
  });

  it('los adjuntos se ven en pantalla sin descargarlos; el XML como texto y el ZIP no', async () => {
    const t = await nueva(ctx, { facturas: [
      { numero: 'VR-1', archivos: [pdf('VR-1.pdf'), archivoXml({ numero: 'VR-1' })] },
      { archivos: [zipFactura({ numero: 'VR-2' })] },
    ] });
    const s = await sesion('ops.sst@hesego.test');
    const d = (await app.inject({ method: 'GET', url: `/api/transacciones/${t.id}`, headers: s })).json();
    const de = (nombre: RegExp) => d.adjuntos.find((a: any) => nombre.test(a.nombre_original)).id;

    const vpdf = await app.inject({ method: 'GET', url: `/api/adjuntos/${de(/^VR-1\.pdf$/)}/ver`, headers: s });
    expect(vpdf.statusCode).toBe(200);
    expect(vpdf.headers['content-type']).toBe('application/pdf');
    expect(vpdf.headers['content-disposition']).toMatch(/^inline;/);

    const vxml = await app.inject({ method: 'GET', url: `/api/adjuntos/${de(/^VR-1\.xml$/)}/ver`, headers: s });
    expect(vxml.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(vxml.body).toContain('<cbc:ID>VR-1</cbc:ID>');

    const vzip = await app.inject({ method: 'GET', url: `/api/adjuntos/${de(/\.zip$/)}/ver`, headers: s });
    expect(vzip.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/api/adjuntos/${de(/^VR-1\.pdf$/)}/ver` })).statusCode).toBe(401);
  });

  it('reasigna por HTTP y los errores llegan con código y mensaje en español', async () => {
    const t = await nueva(ctx);
    const s = await sesion('contabilidad1@hesego.test');
    const r = await app.inject({ method: 'POST', url: `/api/transacciones/${t.id}/reasignar`, headers: s,
      payload: { version: t.version, usuarioId: await idUsuario(ctx, 'ops.inventario@hesego.test'), motivo: 'Vacaciones' } });
    expect(r.statusCode, r.body).toBe(200);

    const sinNumero = await enviar('/api/transacciones', s, { asignarA: await idUsuario(ctx, 'ops.sst@hesego.test') }, [pdf()]);
    expect(sinNumero.statusCode).toBe(422);
    expect(sinNumero.json()).toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: 'Escribe el número de la factura' });
    expect((await app.inject({ method: 'GET', url: '/api/transacciones/999999', headers: s })).statusCode).toBe(404);
  });
});

describe('Protección del login', () => {
  // Va al final: agota el cupo de intentos de esta IP
  it('bloquea la fuerza bruta tras 10 intentos por minuto', async () => {
    const intentos = [];
    for (let i = 0; i < 12; i++) {
      intentos.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'gerencia1@hesego.test', password: `x${i}` } })).statusCode);
    }
    expect(intentos.at(-1)).toBe(429);
    const bloqueado = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'gerencia1@hesego.test', password: CLAVE_DEMO } });
    expect(bloqueado.json()).toMatchObject({ codigo: 'DEMASIADOS_INTENTOS' });
  });
});
