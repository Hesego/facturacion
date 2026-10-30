// Prepara la base de datos de las pruebas.
//  - Por defecto: PGlite (Postgres embebido, sin Docker) con las migraciones y semillas del repo.
//  - Con PRUEBAS_DATABASE_URL: usa ese Postgres, que debe estar migrado y con SEED_DEMO=true y
//    DEMO_PASSWORD=Hesego2026* (por ejemplo, el del docker-compose). Conéctese como gastos_app.
import { iniciarBDEmbebida } from '../scripts/bd-embebida.js';

export default async function preparar() {
  if (process.env.PRUEBAS_DATABASE_URL) {
    process.env.URL_BD_PRUEBAS = process.env.PRUEBAS_DATABASE_URL;
    process.env.ROL_PRUEBAS = '';
    return;
  }
  const bd = await iniciarBDEmbebida({ puerto: Number(process.env.PRUEBAS_PUERTO_PGLITE ?? 54329), claveDemo: 'Hesego2026*' });
  process.env.URL_BD_PRUEBAS = bd.url;
  // Las pruebas corren con el rol de la aplicación: si algo exige más permisos, falla aquí también
  process.env.ROL_PRUEBAS = 'gastos_app';
  return bd.cerrar;
}
