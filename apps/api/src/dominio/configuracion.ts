import type { BD, Trx } from '../db/conexion.js';

/** Claves de `configuracion` que usa la API y su valor por defecto si faltan. */
const POR_DEFECTO = {
  equipos_pueden_anular: ['contabilidad', 'administrador'] as string[],
  equipos_gestionan_facturas: ['contabilidad'] as string[],
  equipos_pueden_reasignar: ['contabilidad', 'administrador'] as string[],
  adjuntos_tamano_max_mb: 25 as number,
  adjuntos_tipos_permitidos: ['application/pdf', 'image/png', 'image/jpeg', 'application/xml', 'text/xml', 'application/zip'] as string[],
};

export type ClaveConfig = keyof typeof POR_DEFECTO;

export async function leerConfig<K extends ClaveConfig>(db: BD | Trx, clave: K): Promise<(typeof POR_DEFECTO)[K]> {
  const fila = await db.selectFrom('configuracion').select('valor').where('clave', '=', clave).executeTakeFirst();
  return (fila?.valor as (typeof POR_DEFECTO)[K] | undefined) ?? POR_DEFECTO[clave];
}
