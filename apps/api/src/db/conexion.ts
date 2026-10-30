import pg from 'pg';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Database } from './esquema.js';

// bigint (ids) como number: los ids caben de sobra en 2^53. numeric (pesos) se queda como texto.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// date como texto AAAA-MM-DD, sin conversión de zona horaria
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type BD = Kysely<Database>;
export type Trx = Transaction<Database>;

export function crearBD(url: string, opciones: { max?: number } = {}): BD {
  const pool = new pg.Pool({ connectionString: url, max: opciones.max ?? 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
