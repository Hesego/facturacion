// Lectura de la factura electrónica DIAN (UBL 2.1). El usuario solo sube archivos: si trae el
// XML (suelto o dentro del ZIP que entrega el proveedor), de aquí salen el número, el CUFE, el
// NIT, el proveedor, la fecha y el valor, sin que nadie los digite. Solo se usan para validar
// duplicados y mostrar; el proceso contable vive en otra plataforma.
import { strFromU8, unzipSync } from 'fflate';
import { ErrorNegocio } from './errores.js';

export interface ArchivoEntrante {
  nombre: string;
  mime: string;
  contenido: Buffer;
}

export interface DatosFacturaElectronica {
  numero?: string;
  cufe?: string;
  nit?: string;
  proveedor?: string;
  fecha?: string;
  valor?: string;
}

const esPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const esZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const esXml = (b: Buffer) => b.subarray(0, 64).toString('utf8').replace(/^﻿/, '').trimStart().startsWith('<');

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e] ?? m).trim();

/** Valor del primer elemento con ese nombre local (sin importar el prefijo de espacio de nombres). */
function etiqueta(xml: string, nombre: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${nombre}>`));
  return m?.[1] ? decodificar(m[1]) : undefined;
}
function bloque(xml: string, nombre: string): string {
  return xml.match(new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`))?.[1] ?? '';
}

/** Lee el Invoice. Acepta la factura sola o el AttachedDocument de la DIAN (que la trae en un CDATA). */
export function leerXmlFactura(xml: string): DatosFacturaElectronica {
  const interno = xml.match(/<!\[CDATA\[\s*((?:<\?xml[^>]*>\s*)?<(?:[\w-]+:)?Invoice[\s>][\s\S]*?)\]\]>/)?.[1] ?? xml;
  const factura = interno.replace(/<(?:[\w-]+:)?UBLExtensions[\s\S]*?<\/(?:[\w-]+:)?UBLExtensions>/, '');
  const proveedor = bloque(factura, 'AccountingSupplierParty');
  const cufe = etiqueta(factura, 'UUID')?.toLowerCase();
  const valor = etiqueta(bloque(factura, 'LegalMonetaryTotal'), 'PayableAmount');
  const datos: DatosFacturaElectronica = {
    numero: etiqueta(factura, 'ID'),
    cufe: cufe && /^[0-9a-f]{96}$/.test(cufe) ? cufe : undefined,
    nit: etiqueta(proveedor, 'CompanyID')?.replace(/\D/g, '') || undefined,
    proveedor: etiqueta(proveedor, 'RegistrationName'),
    fecha: etiqueta(factura, 'IssueDate')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0],
    valor: valor && /^\d+(\.\d+)?$/.test(valor) ? Number(valor).toFixed(2) : undefined,
  };
  if (!datos.cufe && !datos.nit) {
    throw new ErrorNegocio('ARCHIVO_INVALIDO', 'El XML no parece una factura electrónica de la DIAN (no tiene CUFE ni NIT del proveedor)');
  }
  return datos;
}

export interface ArchivosFactura {
  /** PDF de la factura (subido directo o sacado del ZIP). Obligatorio. */
  pdf: ArchivoEntrante;
  /** XML o ZIP original de la DIAN, que se guarda como soporte. */
  electronica?: ArchivoEntrante;
  datos: DatosFacturaElectronica;
}

/**
 * Ordena lo que subió el usuario: un PDF, y opcionalmente el XML o el ZIP de la DIAN (del que
 * también se puede sacar el PDF si no lo subieron aparte).
 */
export function separarArchivosFactura(archivos: ArchivoEntrante[]): ArchivosFactura {
  let pdf: ArchivoEntrante | undefined;
  let electronica: ArchivoEntrante | undefined;
  let xml: string | undefined;

  for (const a of archivos) {
    if (esPdf(a.contenido)) {
      if (pdf) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Sube un solo PDF por factura');
      pdf = { ...a, mime: 'application/pdf' };
    } else if (esZip(a.contenido)) {
      let entradas: Record<string, Uint8Array>;
      try {
        entradas = unzipSync(new Uint8Array(a.contenido));
      } catch {
        throw new ErrorNegocio('ARCHIVO_INVALIDO', `No se pudo abrir el ZIP «${a.nombre}»`);
      }
      for (const [nombre, contenido] of Object.entries(entradas)) {
        const b = Buffer.from(contenido);
        if (!pdf && /\.pdf$/i.test(nombre) && esPdf(b)) pdf = { nombre: nombre.split('/').pop()!, mime: 'application/pdf', contenido: b };
        if (!xml && /\.xml$/i.test(nombre)) xml = strFromU8(contenido);
      }
      electronica = { ...a, mime: 'application/zip' };
    } else if (esXml(a.contenido)) {
      xml = a.contenido.toString('utf8');
      electronica = { ...a, mime: 'application/xml' };
    } else {
      throw new ErrorNegocio('ARCHIVO_INVALIDO', `«${a.nombre}» no es un PDF, XML ni ZIP de factura`);
    }
  }
  if (!pdf) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Falta el PDF de la factura (súbelo directo o dentro del ZIP de la DIAN)');
  return { pdf, electronica, datos: xml ? leerXmlFactura(xml) : {} };
}
