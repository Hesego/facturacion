// Postgres embebido (PGlite) con las migraciones y semillas del repo, servido por socket para
// que la API use el mismo driver `pg` que en producción. Lo usan las pruebas y el modo demo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));

export async function iniciarBDEmbebida(opciones: { puerto: number; claveDemo: string }) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { citext } });

  // Lo que hace db/init/01-roles-y-bases.sh. PGlite no trae pgcrypto: crypt/gen_salt solo los
  // usan las semillas y aquí se reemplazan los hashes justo después con bcrypt real.
  await db.exec(`
    CREATE ROLE gastos_owner; CREATE ROLE gastos_app; CREATE ROLE gastos_n8n;
    CREATE FUNCTION gen_salt(text, int) RETURNS text LANGUAGE sql AS $$ SELECT 'x' $$;
    CREATE FUNCTION crypt(text, text) RETURNS text LANGUAGE sql AS $$ SELECT 'pendiente' $$;
  `);

  const dirMig = path.join(RAIZ, 'db/migrations');
  for (const f of fs.readdirSync(dirMig).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dirMig, f), 'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
    const up = sql.split(/^-- migrate:(?:up|down)\s*$/m)[1]!;
    await db.exec(`BEGIN; ${up}; COMMIT;`);
  }

  const variables: Record<string, string> = {
    admin_email: 'admin@hesego.test', admin_nombre: 'Administrador', admin_password: 'x', demo_password: 'x',
  };
  for (const sub of ['base', 'demo']) {
    const dir = path.join(RAIZ, 'db/seeds', sub);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/:'(\w+)'/g, (_, v: string) => `'${variables[v]}'`);
      await db.exec(sql);
    }
  }
  await db.query('UPDATE usuarios SET password_hash = $1', [bcrypt.hashSync(opciones.claveDemo, 4)]);

  const servidor = new PGLiteSocketServer({ db, port: opciones.puerto, host: '127.0.0.1' });
  await servidor.start();
  return {
    url: `postgres://postgres@127.0.0.1:${opciones.puerto}/postgres`,
    cerrar: async () => {
      await servidor.stop();
      await db.close();
    },
  };
}
