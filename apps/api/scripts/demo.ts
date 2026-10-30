// Modo demo: levanta la API con Postgres embebido, almacenamiento en memoria y transacciones de
// ejemplo en distintas etapas. Sirve para ver la interfaz sin Docker. Los datos se pierden al cerrar.
//   pnpm demo   (desde la raíz: API en :3000 y la interfaz en :5173)
import { sql } from 'kysely';
import { construirApp } from '../src/app.js';
import { crearBD } from '../src/db/conexion.js';
import { anular, devolver } from '../src/dominio/flujo.js';
import { AlmacenamientoMemoria } from '../src/servicios/almacenamiento.js';
import { iniciarBDEmbebida } from './bd-embebida.js';
import { actor, archivoXml, leer, llevarHasta, nueva, pdf } from './escenarios.js';

const CLAVE = 'Hesego2026*';
const bd = await iniciarBDEmbebida({ puerto: Number(process.env.DEMO_PUERTO_BD ?? 54330), claveDemo: CLAVE });
// PGlite atiende una conexión a la vez
const db = crearBD(bd.url, { max: 1 });
const ctx = { db, appUrl: 'http://localhost:5173', almacenamiento: new AlmacenamientoMemoria() };

/** Simula que la transacción lleva `dias` días hábiles en su etapa actual (solo para el demo). */
async function antiguedad(id: number, dias: number) {
  for (let atras = dias; atras < dias + 15; atras++) {
    const r = await sql<{ d: number }>`SELECT fn_dias_habiles(now() - make_interval(days => ${atras}), now()) AS d`.execute(db);
    if (r.rows[0]!.d >= dias) {
      await sql`UPDATE transacciones SET en_etapa_desde = now() - make_interval(days => ${atras}) WHERE id = ${id}`.execute(db);
      return;
    }
  }
}

let n = 4100;
const factura = (conXml: boolean, valor: string) => {
  const numero = `FE-${++n}`;
  return { numero, archivos: conXml ? [pdf(`${numero}.pdf`), archivoXml({ numero, valor: `${valor}.00` })] : [pdf(`${numero}.pdf`)] };
};

const escenarios: Array<{ para: string; valor: string; descripcion: string; hasta: string; dias?: number; xml?: boolean; destinos?: Record<string, string> }> = [
  { para: 'ops.sst@hesego.test', valor: '1850000', descripcion: 'Botas dieléctricas cuadrillas Jamundí', hasta: 'RQ', xml: true },
  { para: 'ops.tics@hesego.test', valor: '3200000', descripcion: 'Licencias de ofimática sede principal', hasta: 'AP', dias: 1, destinos: { AP: 'lider.tics@hesego.test' } },
  { para: 'ops.inventario@hesego.test', valor: '5400000', descripcion: 'Herramienta de corte y ponchado', hasta: 'OC', dias: 2, xml: true },
  { para: 'ops.sst@hesego.test', valor: '12750000', descripcion: 'Arneses y líneas de vida para alturas', hasta: 'AG', dias: 5 },
  { para: 'ops.tics@hesego.test', valor: '980000', descripcion: 'Radios para supervisores de campo', hasta: 'ES', dias: 3, destinos: { ES: 'ops.tics@hesego.test' } },
  { para: 'ops.inventario@hesego.test', valor: '2300000', descripcion: 'Conectores para mantenimiento preventivo', hasta: 'PG_ENV', xml: true },
  { para: 'ops.sst@hesego.test', valor: '4100000', descripcion: 'Transporte de personal a Tolima', hasta: 'PG_APR', dias: 1 },
  { para: 'ops.tics@hesego.test', valor: '1250000', descripcion: 'Mantenimiento de equipos de cómputo', hasta: 'RP' },
];

for (const e of escenarios) {
  const t = await nueva(ctx, { para: e.para, valor: e.valor, descripcion: e.descripcion, ...factura(!!e.xml, e.valor) });
  await llevarHasta(ctx, t.id, e.hasta, e.destinos);
  if (e.dias) await antiguedad(t.id, e.dias);
}

// Un RQ rechazado por el líder: vuelve a operaciones con motivo
const rechazado = await llevarHasta(ctx, (await nueva(ctx, { para: 'ops.sst@hesego.test', valor: '2900000',
  descripcion: 'Guantes dieléctricos clase 2', ...factura(true, '2900000') })).id, 'AP');
await devolver(ctx, await actor(ctx, 'lider.sst@hesego.test'), rechazado.id,
  { version: rechazado.version, motivo: 'El pantallazo no muestra la cantidad solicitada. Por favor adjunta uno legible.' });

// Una solicitud que operaciones devolvió a contabilidad
const devuelta = await nueva(ctx, { para: 'ops.inventario@hesego.test', valor: '640000', descripcion: 'Cinta aislante y marcadores', ...factura(false, '640000') });
await devolver(ctx, await actor(ctx, 'ops.inventario@hesego.test'), devuelta.id,
  { version: devuelta.version, motivo: 'Este gasto no es de inventario: corresponde a SST.' });

// Una anulada
const anulada = await llevarHasta(ctx, (await nueva(ctx, { para: 'ops.inventario@hesego.test', valor: '3300000',
  descripcion: 'Escaleras de fibra de vidrio (duplicada)', ...factura(false, '3300000') })).id, 'OC');
await anular(ctx, await actor(ctx, 'contabilidad2@hesego.test'), anulada.id,
  { version: (await leer(ctx, anulada.id)).version, motivo: 'Solicitud duplicada: el gasto ya está en otra transacción.' });

// Gastos ya pagados, para que el tablero tenga tiempos por etapa
const pagados: Array<[string, string, string]> = [
  ['ops.tics@hesego.test', '2150000', 'Licencias de antivirus corporativo'],
  ['ops.sst@hesego.test', '980000', 'Señalización para trabajo en vía'],
  ['ops.inventario@hesego.test', '4300000', 'Herramientas aisladas 1000 V'],
  ['ops.sst@hesego.test', '1600000', 'Transporte de cuadrilla a Santander'],
  ['ops.tics@hesego.test', '760000', 'Diademas para el centro de control'],
  ['ops.inventario@hesego.test', '3150000', 'Cable de cobre para reposición'],
  ['ops.sst@hesego.test', '2480000', 'Exámenes médicos ocupacionales'],
  ['ops.inventario@hesego.test', '1240000', 'Estantería para bodega'],
];
for (const [para, valor, descripcion] of pagados) {
  await llevarHasta(ctx, (await nueva(ctx, { para, valor, descripcion, ...factura(n % 2 === 0, valor) })).id, 'FT');
}

/**
 * SOLO DEMO: reparte en el tiempo los eventos que acaban de crearse en el mismo segundo, para
 * que los promedios por etapa del tablero se vean realistas. Desactiva un momento la protección
 * de solo inserción, cosa que el rol de la aplicación jamás puede hacer en una base real.
 */
async function repartirEnElTiempo() {
  let semilla = 7;
  const azar = (min: number, max: number) => { semilla = (semilla * 9301 + 49297) % 233280; return min + (semilla / 233280) * (max - min); };
  const HORA = 3_600_000;
  const TRANSICIONES = ['creada', 'avanzada', 'devuelta', 'anulada', 'cerrada'];
  await sql`ALTER TABLE eventos DISABLE TRIGGER eventos_solo_insercion`.execute(db);
  await sql`ALTER TABLE transacciones DISABLE TRIGGER transacciones_cerrada_inmutable`.execute(db);
  try {
    const ts = await db.selectFrom('transacciones').select(['id', 'estado', 'en_etapa_desde']).execute();
    for (const t of ts) {
      const eventos = await db.selectFrom('eventos').select(['id', 'tipo']).where('transaccion_id', '=', t.id).orderBy('id', 'desc').execute();
      let reloj = t.estado === 'en_curso' ? t.en_etapa_desde.getTime() : Date.now() - azar(1, 20) * 24 * HORA;
      const final = reloj;
      let ultimaTransicion: number | null = null;
      for (const [i, e] of eventos.entries()) {
        if (i > 0) reloj -= TRANSICIONES.includes(eventos[i - 1]!.tipo) ? azar(3, 42) * HORA : azar(0.1, 1.5) * HORA;
        if (ultimaTransicion === null && TRANSICIONES.includes(e.tipo) && e.tipo !== 'cerrada') ultimaTransicion = reloj;
        await sql`UPDATE eventos SET ocurrido_en = ${new Date(reloj)} WHERE id = ${e.id}`.execute(db);
      }
      await sql`UPDATE transacciones
                   SET creado_en = ${new Date(reloj)},
                       cerrado_en = CASE WHEN estado = 'en_curso' THEN NULL ELSE ${new Date(final)}::timestamptz END,
                       en_etapa_desde = ${new Date(t.estado === 'en_curso' ? ultimaTransicion ?? final : final)}
                 WHERE id = ${t.id}`.execute(db);
    }
  } finally {
    await sql`ALTER TABLE eventos ENABLE TRIGGER eventos_solo_insercion`.execute(db);
    await sql`ALTER TABLE transacciones ENABLE TRIGGER transacciones_cerrada_inmutable`.execute(db);
  }
}
await repartirEnElTiempo();

const app = await construirApp({
  config: { APP_URL: ctx.appUrl, SESION_HORAS: 10, COOKIE_SECURE: false, NODE_ENV: 'development' },
  db, almacenamiento: ctx.almacenamiento,
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 3000) });

console.log(`
  API de demostración lista en http://127.0.0.1:${process.env.PORT ?? 3000}
  Interfaz: http://localhost:5173   ·   Clave de todos los usuarios: ${CLAVE}
  Pruebe con contabilidad1@ · ops.sst@ · lider.sst@ · compras1@ · gerencia1@ · gfinanciera1@hesego.test
`);

const cerrar = async () => {
  await app.close();
  await db.destroy();
  await bd.cerrar();
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
