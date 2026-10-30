import { sql } from 'kysely';
import { formatearCOP } from '@gastos/shared';
import type { Trx } from '../db/conexion.js';
import type { Etapa, Transaccion } from '../db/esquema.js';
import type { Actor, Persona } from './autorizacion.js';
import { leerConfig } from './configuracion.js';

/** Tipos de evento que la API publica en el outbox (los consume n8n). */
export type TipoOutbox = 'transaccion.avanzada' | 'transaccion.devuelta' | 'transaccion.reasignada' | 'transaccion.anulada' | 'transaccion.cerrada';

/** Solicitante + equipos de seguimiento (contabilidad), sin repetir y sin quien hizo el cambio. */
async function seguimiento(trx: Trx, t: Transaccion, excluirId: number | null): Promise<Persona[]> {
  const equipos = await leerConfig(trx, 'equipos_seguimiento');
  const filas = await trx
    .selectFrom('usuarios as u')
    .select(['u.id', 'u.email', 'u.nombre'])
    .where('u.activo', '=', true)
    .where((eb) => eb.or([
      eb('u.id', '=', t.solicitante_id),
      eb.exists(eb.selectFrom('usuario_equipo as ue').innerJoin('equipos as e', 'e.id', 'ue.equipo_id')
        .whereRef('ue.usuario_id', '=', 'u.id').where('e.codigo', 'in', equipos.length ? equipos : ['__ninguno__']).select(sql`1`.as('x'))),
    ]))
    .orderBy('u.nombre')
    .execute();
  return filas.filter((p) => p.id !== excluirId);
}

/** Todos los que actuaron en la transacción, más el solicitante. */
async function participantes(trx: Trx, t: Transaccion): Promise<Persona[]> {
  return trx
    .selectFrom('usuarios as u')
    .select(['u.id', 'u.email', 'u.nombre'])
    .where('u.activo', '=', true)
    .where((eb) => eb.or([
      eb('u.id', '=', t.solicitante_id),
      eb('u.id', 'in', eb.selectFrom('eventos').select('actor_id').where('transaccion_id', '=', t.id).where('actor_id', 'is not', null)),
    ]))
    .orderBy('u.nombre')
    .execute();
}

interface DatosEmision {
  tipo: TipoOutbox;
  eventoId: number;
  /** Estado de la transacción DESPUÉS del cambio. */
  t: Transaccion;
  origen: Etapa | null;
  destino: Etapa | null;
  actor: Actor | null;
  motivo?: string | null;
  comentario?: string | null;
  appUrl: string;
}

/**
 * Inserta el evento en el outbox, dentro de la misma transacción del cambio de estado.
 * Los destinatarios se resuelven aquí: decidir a quién avisar es lógica de negocio y no le toca a n8n.
 */
export async function emitirOutbox(trx: Trx, d: DatosEmision): Promise<void> {
  const [solicitante, asignado, facturas, area] = await Promise.all([
    trx.selectFrom('usuarios').select('nombre').where('id', '=', d.t.solicitante_id).executeTakeFirstOrThrow(),
    d.t.asignado_a ? trx.selectFrom('usuarios').select(['id', 'email', 'nombre']).where('id', '=', d.t.asignado_a).where('activo', '=', true).executeTakeFirst() : undefined,
    trx.selectFrom('facturas').select(['numero', 'proveedor_nombre']).where('transaccion_id', '=', d.t.id).where('activa', '=', true).orderBy('id').execute(),
    d.t.area_id ? trx.selectFrom('areas').select('nombre').where('id', '=', d.t.area_id).executeTakeFirst() : undefined,
  ]);

  const cierre = d.tipo === 'transaccion.cerrada' || d.tipo === 'transaccion.anulada';
  const payload = {
    version_payload: 2,
    evento: { id: d.eventoId, tipo: d.tipo, ocurrido_en: new Date().toISOString() },
    transaccion: {
      id: d.t.id,
      consecutivo: d.t.consecutivo,
      estado: d.t.estado,
      valor: d.t.valor,
      valor_formateado: d.t.valor ? formatearCOP(d.t.valor) : null,
      descripcion: d.t.descripcion,
      facturas: facturas.map((f) => f.numero),
      proveedor: facturas.find((f) => f.proveedor_nombre)?.proveedor_nombre ?? null,
      solicitante: solicitante.nombre,
      asignado: asignado?.nombre ?? null,
      area: area?.nombre ?? null,
      url: `${d.appUrl.replace(/\/$/, '')}/transacciones/${d.t.id}`,
    },
    etapa_origen: d.origen && { codigo: d.origen.codigo, nombre: d.origen.nombre },
    etapa_destino: d.destino && { codigo: d.destino.codigo, nombre: d.destino.nombre, sla_dias: d.destino.sla_dias },
    actor: d.actor && { nombre: d.actor.nombre, email: d.actor.email },
    motivo: d.motivo ?? null,
    comentario: d.comentario ?? null,
    destinatarios: {
      // La persona a la que se le asignó la transacción (vacío en cierre y anulación)
      responsables: !cierre && asignado ? [asignado] : [],
      // Solicitante y contabilidad, dueña del proceso
      seguimiento: await seguimiento(trx, d.t, d.actor?.id ?? null),
      // Todos los que participaron (solo en cierre y anulación)
      participantes: cierre ? await participantes(trx, d.t) : [],
    },
  };

  await trx.insertInto('outbox_eventos')
    .values({ evento_id: d.eventoId, transaccion_id: d.t.id, tipo: d.tipo, payload: JSON.stringify(payload) })
    .execute();
}
