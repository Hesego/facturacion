// Facturas: el usuario solo sube el archivo y escribe el número. Si adjunta el XML/ZIP de la
// DIAN, el NIT, el CUFE, el proveedor, la fecha y el valor se leen solos.
//
// Duplicado (en todo el sistema, contra facturas activas):
//   · mismo CUFE, o
//   · mismo PDF (mismo SHA-256), o
//   · mismo número, salvo que ambas tengan NIT y sea distinto (de otro proveedor).
import { sql } from 'kysely';
import { ADJUNTO_FACTURA, ADJUNTO_FACTURA_XML } from '@gastos/shared';
import type { BD, Trx } from '../db/conexion.js';
import type { Almacenamiento } from '../servicios/almacenamiento.js';
import { subir, insertarAdjunto, eventoSoporte, validarArchivo, type ArchivoValidado } from './archivos.js';
import type { Actor } from './autorizacion.js';
import { ErrorNegocio, violacionUnica } from './errores.js';
import { separarArchivosFactura, type ArchivoEntrante, type DatosFacturaElectronica } from './factura-electronica.js';

export interface FacturaPreparada {
  numero: string;
  datos: DatosFacturaElectronica;
  pdf: ArchivoValidado;
  electronica?: ArchivoValidado;
  clavePdf: string;
  claveElectronica?: string;
}

const normalizar = (n: string) => n.trim().toUpperCase();

/** Busca una factura activa que choque con la nueva. */
async function buscarDuplicada(db: BD | Trx, numero: string, datos: DatosFacturaElectronica, sha256: string) {
  const r = await sql<{ consecutivo: string; numero: string; cufe: string | null; proveedor_nit: string | null; sha256: string }>`
    SELECT t.consecutivo, f.numero, f.cufe, f.proveedor_nit, a.sha256
    FROM facturas f
    JOIN transacciones t ON t.id = f.transaccion_id
    JOIN adjuntos a ON a.id = f.adjunto_id
    WHERE f.activa
      AND ( (${datos.cufe ?? null}::text IS NOT NULL AND f.cufe = ${datos.cufe ?? null})
         OR a.sha256 = ${sha256}
         OR (upper(f.numero) = ${normalizar(numero)}
             AND (${datos.nit ?? null}::text IS NULL OR f.proveedor_nit IS NULL OR f.proveedor_nit = ${datos.nit ?? null})))
    LIMIT 1`.execute(db);
  const d = r.rows[0];
  if (!d) return null;
  const criterio = datos.cufe && d.cufe === datos.cufe ? 'cufe' : d.sha256 === sha256 ? 'archivo' : 'numero';
  const detalle = criterio === 'cufe' ? 'mismo CUFE'
    : criterio === 'archivo' ? 'el mismo archivo PDF'
    : datos.nit && d.proveedor_nit ? `mismo número ${d.numero} y mismo NIT del proveedor`
    : `mismo número ${d.numero}. Si es de otro proveedor, adjunta el XML o ZIP de la DIAN para distinguirlas`;
  return new ErrorNegocio('FACTURA_DUPLICADA', `Esta factura ya está registrada en ${d.consecutivo} (${detalle})`, { consecutivo: d.consecutivo, criterio });
}

/**
 * Valida y sube los archivos de una factura (antes de abrir la transacción de base de datos).
 * El número puede venir escrito o leerse del XML; si vienen ambos, deben coincidir.
 */
export async function prepararFactura(db: BD, almacenamiento: Almacenamiento, numeroEscrito: string | undefined, archivos: ArchivoEntrante[]): Promise<FacturaPreparada> {
  if (!archivos.length) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Adjunta el PDF de la factura');
  const { pdf, electronica, datos } = separarArchivosFactura(archivos);
  const numero = numeroEscrito?.trim() || datos.numero;
  if (!numero) throw new ErrorNegocio('DATOS_INVALIDOS', 'Escribe el número de la factura');
  if (numeroEscrito && datos.numero && normalizar(numeroEscrito) !== normalizar(datos.numero)) {
    throw new ErrorNegocio('DATOS_INVALIDOS', `El número escrito (${numeroEscrito}) no coincide con el de la factura electrónica (${datos.numero})`);
  }
  const pdfValidado = await validarArchivo(db, pdf, ['application/pdf']);
  const electronicaValidada = electronica ? await validarArchivo(db, electronica, ['application/xml', 'text/xml', 'application/zip']) : undefined;

  const duplicada = await buscarDuplicada(db, numero, datos, pdfValidado.sha256);
  if (duplicada) throw duplicada;

  return {
    numero, datos, pdf: pdfValidado, electronica: electronicaValidada,
    clavePdf: await subir(almacenamiento, 'facturas', pdfValidado),
    claveElectronica: electronicaValidada ? await subir(almacenamiento, 'facturas', electronicaValidada) : undefined,
  };
}

/** Una factura tal como llega del formulario: su número (opcional si trae el XML) y sus archivos. */
export interface FacturaEntrante {
  numero?: string;
  archivos: ArchivoEntrante[];
}

/** Prepara varias facturas y verifica que no se repitan dentro de la misma tanda. */
export async function prepararFacturas(db: BD, almacenamiento: Almacenamiento, facturas: FacturaEntrante[]): Promise<FacturaPreparada[]> {
  const listas: FacturaPreparada[] = [];
  for (const [i, f] of facturas.entries()) {
    let p: FacturaPreparada;
    try {
      p = await prepararFactura(db, almacenamiento, f.numero, f.archivos);
    } catch (e) {
      // Con varias facturas, el mensaje dice cuál falló
      if (e instanceof ErrorNegocio && facturas.length > 1) {
        throw new ErrorNegocio(e.codigo, `Factura ${f.numero?.trim() || i + 1}: ${e.message}`, e.detalles);
      }
      throw e;
    }
    const repetida = listas.find((o) => normalizar(o.numero) === normalizar(p.numero) && (!o.datos.nit || !p.datos.nit || o.datos.nit === p.datos.nit)
      || (p.datos.cufe && o.datos.cufe === p.datos.cufe) || o.pdf.sha256 === p.pdf.sha256);
    if (repetida) throw new ErrorNegocio('FACTURA_DUPLICADA', `La factura ${p.numero} está repetida en esta misma solicitud`, { criterio: 'tanda' });
    listas.push(p);
  }
  return listas;
}

/** Registra la factura dentro de la transacción de base de datos, revalidando duplicados con bloqueo. */
export async function insertarFactura(trx: Trx, bucket: string, actor: Actor, transaccionId: number, etapaId: number, f: FacturaPreparada) {
  // Serializa los registros del mismo número para que dos personas no lo registren a la vez
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`factura:${normalizar(f.numero)}`}))`.execute(trx);
  const duplicada = await buscarDuplicada(trx, f.numero, f.datos, f.pdf.sha256);
  if (duplicada) throw duplicada;

  try {
    const pdf = await insertarAdjunto(trx, bucket, actor, transaccionId, etapaId, ADJUNTO_FACTURA, f.pdf, f.clavePdf);
    const xml = f.electronica && f.claveElectronica
      ? await insertarAdjunto(trx, bucket, actor, transaccionId, etapaId, ADJUNTO_FACTURA_XML, f.electronica, f.claveElectronica)
      : undefined;
    const factura = await trx
      .insertInto('facturas')
      .values({
        transaccion_id: transaccionId, etapa_id: etapaId, numero: f.numero.trim(), adjunto_id: pdf.id, xml_adjunto_id: xml?.id ?? null,
        proveedor_nit: f.datos.nit ?? null, proveedor_nombre: f.datos.proveedor ?? null, cufe: f.datos.cufe ?? null,
        fecha: f.datos.fecha ?? null, valor: f.datos.valor ?? null, registrada_por: actor.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await eventoSoporte(trx, transaccionId, etapaId, actor.id, 'factura_agregada',
      { factura_id: factura.id, numero: factura.numero, valor: factura.valor, con_xml: !!xml });
    return factura;
  } catch (e) {
    const r = violacionUnica(e);
    if (r === 'facturas_cufe_uq' || r === 'facturas_nit_numero_uq' || r === 'adjuntos_factura_sha_uq') {
      throw new ErrorNegocio('FACTURA_DUPLICADA', 'Esta factura ya está registrada en otra transacción');
    }
    throw e;
  }
}
