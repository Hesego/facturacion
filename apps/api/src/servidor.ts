import pg from 'pg';
import { construirApp } from './app.js';
import { cargarConfig } from './config.js';
import { crearBD } from './db/conexion.js';
import { AlmacenamientoS3 } from './servicios/almacenamiento.js';
import { RelayOutbox } from './servicios/relay-outbox.js';

const config = cargarConfig();
const db = crearBD(config.DATABASE_URL);
const app = await construirApp({ config, db, almacenamiento: new AlmacenamientoS3(config) });

// Relay del outbox hacia n8n: despierta con cada NOTIFY de la base y además sondea cada 15 s
let relay: RelayOutbox | null = null;
let escucha: pg.Client | null = null;
if (config.N8N_WEBHOOK_BASE && config.N8N_WEBHOOK_TOKEN) {
  relay = new RelayOutbox(db, { baseUrl: config.N8N_WEBHOOK_BASE, token: config.N8N_WEBHOOK_TOKEN, log: app.log });
  relay.iniciar();
  escucha = new pg.Client({ connectionString: config.DATABASE_URL });
  escucha.on('notification', () => void relay?.despertar());
  escucha.on('error', (e) => app.log.warn({ err: e }, 'LISTEN del outbox caído; el relay sigue sondeando'));
  await escucha.connect().then(() => escucha!.query('LISTEN outbox_eventos')).catch((e) =>
    app.log.warn({ err: e }, 'No se pudo escuchar el outbox; el relay sigue sondeando'));
  app.log.info({ n8n: config.N8N_WEBHOOK_BASE }, 'Relay del outbox activo');
} else {
  app.log.warn('N8N_WEBHOOK_BASE o N8N_WEBHOOK_TOKEN sin definir: el outbox se acumula y no se envían notificaciones');
}

const cerrar = async () => {
  await app.close();
  await relay?.detener();
  await escucha?.end().catch(() => undefined);
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);

await app.listen({ host: '0.0.0.0', port: config.PORT });
