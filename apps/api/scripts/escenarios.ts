// Recorre el flujo semilla con la persona asignada en cada etapa. Lo usan las pruebas y los
// datos del modo demo.
import { randomBytes, randomUUID } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import type { BD } from '../src/db/conexion.js';
import type { Transaccion } from '../src/db/esquema.js';
import type { Actor } from '../src/dominio/autorizacion.js';
import type { ArchivoEntrante } from '../src/dominio/factura-electronica.js';
import { avanzar, crearSolicitud, type ContextoFlujo } from '../src/dominio/flujo.js';
import { cargarActor } from '../src/servicios/autenticacion.js';

export async function actor(ctx: { db: BD }, email: string): Promise<Actor> {
  const u = await ctx.db.selectFrom('usuarios').select('id').where('email', '=', email).executeTakeFirstOrThrow();
  return (await cargarActor(ctx.db, u.id))!;
}
export async function idUsuario(ctx: { db: BD }, email: string) {
  return (await ctx.db.selectFrom('usuarios').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
}

export const cufe = () => randomBytes(48).toString('hex');
export const numero = (prefijo: string) => `${prefijo}-${randomUUID().slice(0, 8).toUpperCase()}`;
export const pdf = (nombre = 'soporte.pdf'): ArchivoEntrante => ({
  nombre, mime: 'application/pdf', contenido: Buffer.from(`%PDF-1.4\n% prueba ${randomUUID()}\n`),
});

/** XML de factura electrónica DIAN (AttachedDocument con el Invoice en CDATA), con lo mínimo que se lee. */
export function xmlFactura(o: { numero: string; nit?: string; cufe?: string; valor?: string; proveedor?: string }): string {
  const invoice = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><sts:DianExtensions xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"><sts:InvoiceControl><sts:InvoiceAuthorization>18760000001</sts:InvoiceAuthorization></sts:InvoiceControl></sts:DianExtensions></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>
  <cbc:ID>${o.numero}</cbc:ID>
  <cbc:UUID schemeID="1" schemeName="CUFE-SHA384">${o.cufe ?? cufe()}</cbc:UUID>
  <cbc:IssueDate>2026-10-20</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme>
    <cbc:RegistrationName>${o.proveedor ?? 'Dotaciones Seguras de Colombia S.A.S.'}</cbc:RegistrationName>
    <cbc:CompanyID schemeAgencyID="195" schemeID="8" schemeName="31">${o.nit ?? '830098765'}</cbc:CompanyID>
  </cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>900502031</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">1260504.20</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">${o.valor ?? '1500000.00'}</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>AD-${o.numero}</cbc:ID>
  <cac:Attachment><cac:ExternalReference><cbc:MimeCode>text/xml</cbc:MimeCode><cbc:Description><![CDATA[${invoice}]]></cbc:Description></cac:ExternalReference></cac:Attachment>
</AttachedDocument>`;
}
export const archivoXml = (o: Parameters<typeof xmlFactura>[0]): ArchivoEntrante =>
  ({ nombre: `${o.numero}.xml`, mime: 'application/xml', contenido: Buffer.from(xmlFactura(o)) });
/** ZIP como el que entrega la DIAN: el PDF y el XML adentro. */
export const zipFactura = (o: Parameters<typeof xmlFactura>[0]): ArchivoEntrante => ({
  nombre: `${o.numero}.zip`, mime: 'application/zip',
  contenido: Buffer.from(zipSync({ [`${o.numero}.xml`]: strToU8(xmlFactura(o)), [`${o.numero}.pdf`]: pdf().contenido })),
});

export async function leer(ctx: { db: BD }, id: number): Promise<Transaccion> {
  return ctx.db.selectFrom('transacciones').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}
export async function codigoEtapa(ctx: { db: BD }, t: Transaccion): Promise<string> {
  return (await ctx.db.selectFrom('catalogo_etapas').select('codigo').where('id', '=', t.etapa_actual_id).executeTakeFirstOrThrow()).codigo;
}

/** A quién se le envía cada etapa en el camino feliz (puede cambiarse por escenario). */
export const DESTINO: Record<string, string> = {
  RQ: 'ops.sst@hesego.test', AP: 'lider.sst@hesego.test', OC: 'compras1@hesego.test', AG: 'gerencia1@hesego.test',
  ES: 'ops.sst@hesego.test', PG_ENV: 'contabilidad1@hesego.test', PG_APR: 'gfinanciera1@hesego.test', RP: 'contabilidad2@hesego.test',
};

/** Contabilidad1 sube la factura (o varias) y la envía a operaciones: queda en RQ. */
export async function nueva(
  ctx: ContextoFlujo,
  o: { numero?: string; para?: string; valor?: string; descripcion?: string; archivos?: ArchivoEntrante[];
       facturas?: { numero?: string; archivos: ArchivoEntrante[] }[]; soportes?: ArchivoEntrante[] } = {},
) {
  const contab = await actor(ctx, 'contabilidad1@hesego.test');
  return crearSolicitud(ctx, contab, {
    asignarA: await idUsuario(ctx, o.para ?? DESTINO.RQ!),
    valor: o.valor ?? '1500000',
    descripcion: o.descripcion ?? 'Elementos de protección personal',
    comentario: 'Favor validar la factura y montar el requerimiento',
  }, o.facturas ?? [{ numero: o.numero ?? numero('FE'), archivos: o.archivos ?? [pdf('factura.pdf')] }], o.soportes);
}

/** Documento y número que pide cada etapa en el camino feliz. */
const PASOS: Record<string, { numero?: string; documento?: string; comentario?: string }> = {
  RQ: { numero: 'RQ', documento: 'pantallazo.pdf' },
  AP: { comentario: 'RQ aprobado' },
  OC: { numero: 'OC', documento: 'oc.pdf' },
  AG: { comentario: 'OC aprobada' },
  ES: { numero: 'ES', documento: 'evidencia.pdf' },
  PG_ENV: {},
  PG_APR: { comentario: 'Pago aprobado' },
  RP: { numero: 'CP', documento: 'comprobante.pdf' },
  SOL: {},
};

/** La persona asignada completa su etapa y la envía a quien indique DESTINO (o `destinos`). */
export async function completarEtapa(ctx: ContextoFlujo, id: number, destinos: Record<string, string> = {}): Promise<Transaccion> {
  const t = await leer(ctx, id);
  const etapa = await codigoEtapa(ctx, t);
  const paso = PASOS[etapa];
  if (!paso || !t.asignado_a) throw new Error(`completarEtapa: etapa ${etapa} sin camino definido`);
  const quien = (await cargarActor(ctx.db, t.asignado_a))!;
  const orden = ['SOL', 'RQ', 'AP', 'OC', 'AG', 'ES', 'PG_ENV', 'PG_APR', 'RP', 'FT'];
  const siguiente = orden[orden.indexOf(etapa) + 1]!;
  const para = destinos[siguiente] ?? DESTINO[siguiente];
  return avanzar(ctx, quien, id, {
    version: t.version,
    asignarA: para ? await idUsuario(ctx, para) : undefined,
    numero: paso.numero ? numero(paso.numero) : undefined,
    // Cada etapa deja su observación para la siguiente persona (obligatoria)
    comentario: paso.comentario ?? `${etapa} completada`,
  }, paso.documento ? [pdf(paso.documento)] : []);
}

/** Lleva una transacción hasta que su etapa actual sea `destino`. */
export async function llevarHasta(ctx: ContextoFlujo, id: number, destino: string, destinos: Record<string, string> = {}): Promise<Transaccion> {
  for (let i = 0; i < 20; i++) {
    const t = await leer(ctx, id);
    if ((await codigoEtapa(ctx, t)) === destino) return t;
    await completarEtapa(ctx, id, destinos);
  }
  throw new Error(`No se llegó a ${destino}`);
}
