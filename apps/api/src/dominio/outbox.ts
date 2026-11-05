import { sql } from 'kysely';
import { formatearCOP } from '@gastos/shared';
import type { Trx } from '../db/conexion.js';
import type { Etapa, Transaccion } from '../db/esquema.js';
import type { Actor } from './autorizacion.js';

/** Tipos de evento que la API publica en el outbox (los consume n8n). */
export type TipoOutbox = 'transaccion.avanzada' | 'transaccion.devuelta' | 'transaccion.reasignada' | 'transaccion.anulada' | 'transaccion.cerrada';

/**
 * Observaciones de cada paso, en orden: lo que escribió quien envió (comentario), devolvió,
 * reasignó o anuló (motivo), y los comentarios sueltos. Es la trazabilidad que viaja en el correo.
 */
async function observaciones(trx: Trx, transaccionId: number) {
  const [eventos, comentarios] = await Promise.all([
    trx.selectFrom('eventos as ev')
      .leftJoin('usuarios as u', 'u.id', 'ev.actor_id')
      .leftJoin('catalogo_etapas as o', 'o.id', 'ev.etapa_origen_id')
      .select(['ev.id', 'ev.tipo', 'ev.ocurrido_en', 'u.nombre as actor', 'o.nombre as etapa',
        sql<string | null>`coalesce(ev.motivo, ev.datos->>'comentario')`.as('texto')])
      .where('ev.transaccion_id', '=', transaccionId)
      .where('ev.tipo', 'in', ['avanzada', 'devuelta', 'reasignada', 'anulada'])
      .orderBy('ev.id').execute(),
    trx.selectFrom('comentarios as c').innerJoin('usuarios as u', 'u.id', 'c.autor_id').innerJoin('catalogo_etapas as e', 'e.id', 'c.etapa_id')
      .select(['c.creado_en', 'c.texto', 'u.nombre as actor', 'e.nombre as etapa'])
      .where('c.transaccion_id', '=', transaccionId).orderBy('c.id').execute(),
  ]);
  return [
    ...eventos.filter((e) => e.texto?.trim()).map((e) => ({ fecha: new Date(e.ocurrido_en).toISOString(), actor: e.actor, etapa: e.etapa, tipo: e.tipo, texto: e.texto })),
    ...comentarios.map((c) => ({ fecha: new Date(c.creado_en).toISOString(), actor: c.actor, etapa: c.etapa, tipo: 'comentario', texto: c.texto })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
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
  /** En la anulación: quien tenía la transacción pendiente (la anulación ya dejó `asignado_a` en NULL). */
  teniaAsignadoId?: number | null;
  appUrl: string;
}

/**
 * Inserta el evento en el outbox, dentro de la misma transacción del cambio de estado.
 * Los destinatarios se resuelven aquí: decidir a quién avisar es lógica de negocio y no le toca a n8n.
 *
 * Regla (2026-11-05): solo recibe correo el destinatario del paso, nunca un equipo completo.
 * - Avance, devolución y reasignación: la persona a la que se le asignó la transacción.
 * - Anulación: la persona que la tenía pendiente (si no es quien anuló).
 * - Cierre (pagada): el solicitante.
 */
export async function emitirOutbox(trx: Trx, d: DatosEmision): Promise<void> {
  const [solicitante, asignado, facturas, area] = await Promise.all([
    trx.selectFrom('usuarios').select('nombre').where('id', '=', d.t.solicitante_id).executeTakeFirstOrThrow(),
    d.t.asignado_a ? trx.selectFrom('usuarios').select(['id', 'email', 'nombre']).where('id', '=', d.t.asignado_a).where('activo', '=', true).executeTakeFirst() : undefined,
    trx.selectFrom('facturas').select(['numero', 'proveedor_nombre']).where('transaccion_id', '=', d.t.id).where('activa', '=', true).orderBy('id').execute(),
    d.t.area_id ? trx.selectFrom('areas').select('nombre').where('id', '=', d.t.area_id).executeTakeFirst() : undefined,
  ]);

  const cerrada = d.tipo === 'transaccion.cerrada';
  const anulada = d.tipo === 'transaccion.anulada';
  const idDestinatario = cerrada ? d.t.solicitante_id : anulada ? (d.teniaAsignadoId ?? null) : d.t.asignado_a;
  const destinatario = idDestinatario && idDestinatario !== d.actor?.id
    ? await trx.selectFrom('usuarios').select(['id', 'email', 'nombre']).where('id', '=', idDestinatario).where('activo', '=', true).executeTakeFirst()
    : undefined;
  const payload = {
    version_payload: 3,
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
    // Todas las observaciones hasta este paso (incluido), de la más antigua a la más reciente
    observaciones: await observaciones(trx, d.t.id),
    destinatarios: {
      // Solo el destinatario del paso (ver la regla arriba); vacío si no hay a quién avisar
      responsables: destinatario ? [destinatario] : [],
    },
  };

  await trx.insertInto('outbox_eventos')
    .values({ evento_id: d.eventoId, transaccion_id: d.t.id, tipo: d.tipo, payload: JSON.stringify(payload) })
    .execute();
}
