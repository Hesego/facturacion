import { describe, expect, it } from 'vitest';
import { anular, avanzar } from '../src/dominio/flujo.js';
import { leerXmlFactura } from '../src/dominio/factura-electronica.js';
import { inactivarFactura, registrarFacturas } from '../src/dominio/soportes.js';
import { actor, archivoXml, cufe, idUsuario, leer, llevarHasta, numero, nueva, pdf, prepararContexto, xmlFactura, zipFactura } from './ayudantes.js';

const ctx = prepararContexto();
const contabilidad = () => actor(ctx, 'contabilidad1@hesego.test');
const facturasDe = (id: number) => ctx.db.selectFrom('facturas').selectAll().where('transaccion_id', '=', id).where('activa', '=', true).execute();

describe('Lo único que se pide: el archivo y el número', () => {
  it('con solo el PDF y el número se registra; los datos contables quedan vacíos', async () => {
    const t = await nueva(ctx, { numero: 'FE-1001', valor: '' });
    const [f] = await facturasDe(t.id);
    expect(f).toMatchObject({ numero: 'FE-1001', proveedor_nit: null, cufe: null, valor: null, xml_adjunto_id: null });
    expect(t.valor).toBeNull();
  });

  it('si adjuntan el XML de la DIAN, el NIT, el CUFE, el proveedor y el valor se leen solos', async () => {
    const c = cufe();
    const t = await nueva(ctx, { numero: 'FV-2002', valor: '', archivos: [pdf('fv.pdf'), archivoXml({ numero: 'FV-2002', nit: '901234567', cufe: c, valor: '3200000.50', proveedor: 'Soluciones TIC Pacífico S.A.S.' })] });
    const [f] = await facturasDe(t.id);
    expect(f).toMatchObject({ proveedor_nit: '901234567', proveedor_nombre: 'Soluciones TIC Pacífico S.A.S.', cufe: c, valor: '3200000.50', fecha: '2026-10-20' });
    expect(f!.xml_adjunto_id).not.toBeNull();
    expect(t.valor).toBe('3200000.50'); // el valor del gasto se toma de la factura si no lo escribieron
  });

  it('con el ZIP de la DIAN basta: el PDF y los datos salen de adentro, y el número también', async () => {
    const t = await nueva(ctx, { numero: '', archivos: [zipFactura({ numero: 'ZP-3003' })] });
    const [f] = await facturasDe(t.id);
    expect(f).toMatchObject({ numero: 'ZP-3003', proveedor_nit: '830098765' });
    const adjuntos = await ctx.db.selectFrom('adjuntos').select(['tipo', 'mime']).where('transaccion_id', '=', t.id).orderBy('id').execute();
    expect(adjuntos).toEqual([{ tipo: 'factura', mime: 'application/pdf' }, { tipo: 'factura_xml', mime: 'application/zip' }]);
  });

  it('valida que lo escrito coincida con el XML y que haya número y PDF', async () => {
    await expect(nueva(ctx, { numero: 'FE-1', archivos: [pdf(), archivoXml({ numero: 'FE-2' })] }))
      .rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS', message: expect.stringContaining('no coincide') });
    await expect(nueva(ctx, { numero: '' })).rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS', message: expect.stringContaining('número de la factura') });
    await expect(nueva(ctx, { archivos: [archivoXml({ numero: 'FE-3' })] })).rejects.toMatchObject({ codigo: 'ARCHIVO_INVALIDO', message: expect.stringContaining('PDF') });
    const exe = { nombre: 'factura.pdf', mime: 'application/pdf', contenido: Buffer.from('MZ\x90\x00 ejecutable') };
    await expect(nueva(ctx, { archivos: [exe] })).rejects.toMatchObject({ codigo: 'ARCHIVO_INVALIDO' });
  });

  it('el lector entiende la factura suelta y el AttachedDocument de la DIAN', () => {
    const adjunto = xmlFactura({ numero: 'SETP990000001', nit: '900123456', valor: '119000' });
    const suelta = adjunto.match(/<!\[CDATA\[([\s\S]*)\]\]>/)![1]!;
    for (const xml of [adjunto, suelta]) {
      expect(leerXmlFactura(xml)).toMatchObject({ numero: 'SETP990000001', nit: '900123456', valor: '119000.00' });
    }
    expect(() => leerXmlFactura('<html><body>no</body></html>')).toThrow(/no parece una factura/);
  });
});

describe('Duplicados en todo el sistema', () => {
  it('rechaza el mismo número de factura e indica dónde está', async () => {
    const a = await nueva(ctx, { numero: 'DUP-500' });
    await expect(nueva(ctx, { numero: 'dup-500' })).rejects.toMatchObject({
      codigo: 'FACTURA_DUPLICADA', message: expect.stringContaining(a.consecutivo), detalles: { criterio: 'numero' },
    });
  });

  it('el mismo número de dos proveedores distintos se permite si ambas traen el XML', async () => {
    await nueva(ctx, { numero: 'FC-77', archivos: [pdf(), archivoXml({ numero: 'FC-77', nit: '800123456' })] });
    const b = await nueva(ctx, { numero: 'FC-77', archivos: [pdf(), archivoXml({ numero: 'FC-77', nit: '901234567' })] });
    expect((await facturasDe(b.id))[0]!.proveedor_nit).toBe('901234567');
  });

  it('rechaza el mismo CUFE y el mismo PDF aunque cambien el número', async () => {
    const c = cufe();
    await nueva(ctx, { numero: '', archivos: [pdf(), archivoXml({ numero: 'CF-1', cufe: c, nit: '800123456' })] });
    await expect(nueva(ctx, { numero: '', archivos: [pdf(), archivoXml({ numero: 'CF-2', cufe: c, nit: '900456789' })] }))
      .rejects.toMatchObject({ codigo: 'FACTURA_DUPLICADA', detalles: { criterio: 'cufe' } });
    const mismoPdf = pdf();
    await nueva(ctx, { archivos: [mismoPdf] });
    await expect(nueva(ctx, { archivos: [mismoPdf] })).rejects.toMatchObject({ codigo: 'FACTURA_DUPLICADA', detalles: { criterio: 'archivo' } });
  });

  it('dos registros simultáneos del mismo número: solo uno pasa', async () => {
    const n = numero('SIM');
    const r = await Promise.allSettled([nueva(ctx, { numero: n }), nueva(ctx, { numero: n })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: { codigo: 'FACTURA_DUPLICADA' } });
  });

  it('las facturas retiradas por error o de transacciones anuladas quedan liberadas', async () => {
    const a = await nueva(ctx, { numero: 'LIB-1' });
    await anular(ctx, await contabilidad(), a.id, { version: (await leer(ctx, a.id)).version, motivo: 'Registrada dos veces' });
    const b = await nueva(ctx, { numero: 'LIB-1' });
    const [f] = await facturasDe(b.id);
    await inactivarFactura(ctx, await contabilidad(), f!.id, 'error_registro');
    await registrarFacturas(ctx, await contabilidad(), b.id, [{ numero: 'LIB-1', archivos: [pdf()] }]);
    expect(await facturasDe(b.id)).toHaveLength(1);
  });
});

describe('Facturas adicionales y antes del pago', () => {
  it('contabilidad agrega más facturas en cualquier etapa; otros equipos no', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'OC');
    await registrarFacturas(ctx, await contabilidad(), t.id, [{ numero: numero('FE'), archivos: [pdf()] }]);
    expect(await facturasDe(t.id)).toHaveLength(2);
    await expect(registrarFacturas(ctx, await actor(ctx, 'compras1@hesego.test'), t.id, [{ numero: numero('FE'), archivos: [pdf()] }])).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
  });

  it('el envío a aprobación de pago exige al menos una factura activa', async () => {
    const t = await llevarHasta(ctx, (await nueva(ctx)).id, 'PG_ENV');
    for (const f of await facturasDe(t.id)) await inactivarFactura(ctx, await contabilidad(), f.id, 'error_registro');
    await expect(avanzar(ctx, await contabilidad(), t.id, { version: t.version, asignarA: await idUsuario(ctx, 'gfinanciera1@hesego.test') }))
      .rejects.toMatchObject({ codigo: 'REQUISITOS_INCOMPLETOS', detalles: [expect.objectContaining({ clave: 'facturas:min' })] });
  });
});

describe('Varias facturas y soportes en la misma solicitud', () => {
  const imagen = (nombre: string) => ({ nombre, mime: 'image/png', contenido: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(nombre)]) });

  it('registra todas las facturas, cada una con su número, y los pantallazos como soportes', async () => {
    const t = await nueva(ctx, {
      facturas: [
        { numero: 'MV-1', archivos: [pdf()] },
        { numero: '', archivos: [pdf(), archivoXml({ numero: 'MV-2', nit: '800123456' })] },
        { archivos: [zipFactura({ numero: 'MV-3', nit: '901234567' })] },
      ],
      soportes: [imagen('pantallazo-correo.png'), imagen('foto-entrega.png')],
    });
    expect((await facturasDe(t.id)).map((f) => f.numero)).toEqual(['MV-1', 'MV-2', 'MV-3']);
    const soportes = await ctx.db.selectFrom('adjuntos').select('nombre_original').where('transaccion_id', '=', t.id).where('tipo', '=', 'soporte_adicional').execute();
    expect(soportes.map((a) => a.nombre_original).sort()).toEqual(['foto-entrega.png', 'pantallazo-correo.png']);
  });

  it('sin valor escrito, el valor del gasto es la suma de los XML', async () => {
    const t = await nueva(ctx, { valor: '', facturas: [
      { archivos: [pdf(), archivoXml({ numero: 'SU-1', valor: '1000000.00' })] },
      { archivos: [zipFactura({ numero: 'SU-2', valor: '250000.50' })] },
    ] });
    expect(t.valor).toBe('1250000.50');
  });

  it('una factura repetida dentro de la misma tanda se rechaza y no se crea nada', async () => {
    const antes = (await ctx.db.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;
    await expect(nueva(ctx, { facturas: [{ numero: 'TD-9', archivos: [pdf()] }, { numero: 'td-9', archivos: [pdf()] }] }))
      .rejects.toMatchObject({ codigo: 'FACTURA_DUPLICADA', detalles: { criterio: 'tanda' } });
    const despues = (await ctx.db.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;
    expect(Number(despues)).toBe(Number(antes));
  });

  it('si una de varias falla, el mensaje dice cuál', async () => {
    await expect(nueva(ctx, { facturas: [{ numero: 'OK-1', archivos: [pdf()] }, { numero: 'MAL-2', archivos: [archivoXml({ numero: 'MAL-2' })] }] }))
      .rejects.toMatchObject({ codigo: 'ARCHIVO_INVALIDO', message: expect.stringMatching(/^Factura MAL-2: .*PDF/) });
  });

  it('contabilidad agrega varias facturas de una vez en el detalle', async () => {
    const t = await nueva(ctx);
    await registrarFacturas(ctx, await contabilidad(), t.id, [{ numero: numero('AD'), archivos: [pdf()] }, { numero: numero('AD'), archivos: [pdf()] }]);
    expect(await facturasDe(t.id)).toHaveLength(3);
  });
});
