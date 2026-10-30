// Archivos de soporte: validación por contenido real, carga a S3 y registro de metadatos.
// Los archivos se suben a S3 ANTES de abrir la transacción de base de datos (para no retener
// bloqueos durante la carga). Si después falla el registro, el objeto queda huérfano pero
// inofensivo: sin metadatos en Postgres no es visible en la aplicación.
import { createHash, randomUUID } from 'node:crypto';
import type { BD, Trx } from '../db/conexion.js';
import type { Almacenamiento } from '../servicios/almacenamiento.js';
import type { Actor } from './autorizacion.js';
import { leerConfig } from './configuracion.js';
import { ErrorNegocio } from './errores.js';
import type { ArchivoEntrante } from './factura-electronica.js';

export type { ArchivoEntrante };

const EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/zip': '.zip',
};

/** Comprueba la firma real del archivo: un .exe renombrado a .pdf no pasa. */
function contenidoCoincide(mime: string, b: Buffer): boolean {
  const empieza = (...bytes: number[]) => bytes.every((x, i) => b[i] === x);
  switch (mime) {
    case 'application/pdf': return b.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png': return empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg': return empieza(0xff, 0xd8, 0xff);
    case 'application/zip': return empieza(0x50, 0x4b, 0x03, 0x04);
    case 'application/xml':
    case 'text/xml': return b.subarray(0, 64).toString('utf8').replace(/^﻿/, '').trimStart().startsWith('<');
    default: return false;
  }
}

export interface ArchivoValidado extends ArchivoEntrante {
  sha256: string;
}

export async function validarArchivo(db: BD | Trx, archivo: ArchivoEntrante, permitidos?: string[]): Promise<ArchivoValidado> {
  const maxMb = await leerConfig(db, 'adjuntos_tamano_max_mb');
  const tipos = permitidos ?? (await leerConfig(db, 'adjuntos_tipos_permitidos'));
  const mime = archivo.mime.split(';')[0]!.trim().toLowerCase();
  if (archivo.contenido.length === 0) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'El archivo está vacío');
  if (archivo.contenido.length > maxMb * 1024 * 1024) {
    throw new ErrorNegocio('ARCHIVO_INVALIDO', `El archivo supera el tamaño máximo de ${maxMb} MB`);
  }
  if (!tipos.includes(mime)) {
    throw new ErrorNegocio('ARCHIVO_INVALIDO', `Tipo de archivo no permitido (${mime}). Se aceptan: ${[...new Set(tipos.map((t) => EXTENSION[t] ?? t))].join(', ')}`);
  }
  if (!contenidoCoincide(mime, archivo.contenido)) {
    throw new ErrorNegocio('ARCHIVO_INVALIDO', `El contenido de «${archivo.nombre}» no corresponde a un archivo ${EXTENSION[mime] ?? mime}`);
  }
  return { ...archivo, mime, sha256: createHash('sha256').update(archivo.contenido).digest('hex') };
}

/** Sube el archivo a S3 y devuelve su clave. */
export async function subir(almacenamiento: Almacenamiento, carpeta: string, a: ArchivoValidado): Promise<string> {
  const clave = `${carpeta}/${randomUUID()}${EXTENSION[a.mime] ?? ''}`;
  await almacenamiento.guardar(clave, a.contenido, a.mime, a.sha256);
  return clave;
}

export async function insertarAdjunto(
  trx: Trx, bucket: string, actor: Actor, transaccionId: number, etapaId: number, tipo: string, a: ArchivoValidado, clave: string,
) {
  return trx
    .insertInto('adjuntos')
    .values({
      transaccion_id: transaccionId, etapa_id: etapaId, tipo, nombre_original: a.nombre.slice(0, 255) || 'archivo',
      mime: a.mime, tamano_bytes: a.contenido.length, sha256: a.sha256, bucket, object_key: clave, subido_por: actor.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export type TipoEventoSoporte =
  | 'adjunto_agregado' | 'adjunto_inactivado' | 'factura_agregada' | 'factura_inactivada' | 'referencia_registrada' | 'comentario';

export async function eventoSoporte(trx: Trx, transaccionId: number, etapaId: number, actorId: number, tipo: TipoEventoSoporte, datos: Record<string, unknown>) {
  await trx
    .insertInto('eventos')
    .values({ transaccion_id: transaccionId, tipo, etapa_origen_id: etapaId, actor_id: actorId, datos: JSON.stringify(datos) })
    .execute();
}
