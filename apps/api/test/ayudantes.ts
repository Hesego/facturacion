import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll } from 'vitest';
import '../src/db/conexion.js'; // registra los parsers de tipos de pg
import type { BD } from '../src/db/conexion.js';
import type { Database } from '../src/db/esquema.js';
import type { ContextoFlujo } from '../src/dominio/flujo.js';
import { AlmacenamientoMemoria } from '../src/servicios/almacenamiento.js';

export * from '../scripts/escenarios.js';

export const CLAVE_DEMO = 'Hesego2026*';

/** Conexión para un archivo de pruebas (una sola conexión, con el rol de la aplicación). Se cierra al terminar. */
export function prepararContexto(): ContextoFlujo & { db: BD; almacenamiento: AlmacenamientoMemoria } {
  const pool = new pg.Pool({ connectionString: process.env.URL_BD_PRUEBAS, max: 1 });
  const rol = process.env.ROL_PRUEBAS;
  if (rol) pool.on('connect', (c) => void c.query(`SET ROLE ${rol}`));
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  afterAll(() => db.destroy());
  return { db, appUrl: 'http://localhost:8080', almacenamiento: new AlmacenamientoMemoria() };
}
