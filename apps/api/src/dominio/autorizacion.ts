import type { BD, Trx } from '../db/conexion.js';
import type { Etapa, Transaccion } from '../db/esquema.js';
import { leerConfig } from './configuracion.js';
import { ErrorNegocio } from './errores.js';

/** Usuario autenticado que ejecuta una acción. */
export interface Actor {
  id: number;
  nombre: string;
  email: string;
  /** Códigos de los equipos a los que pertenece. */
  equipos: string[];
}

export interface Persona {
  id: number;
  nombre: string;
  email: string;
}

/** Cada transacción está asignada a una persona: solo ella actúa en la etapa actual. */
export const esResponsable = (actor: Pick<Actor, 'id'>, t: Transaccion, etapa: Etapa) =>
  t.estado === 'en_curso' && etapa.tipo !== 'sistema' && t.asignado_a === actor.id;

export async function exigirResponsable(db: BD | Trx, actor: Actor, t: Transaccion, etapa: Etapa) {
  if (esResponsable(actor, t, etapa)) return;
  if (etapa.tipo === 'sistema') throw new ErrorNegocio('SIN_PERMISO', `La etapa ${etapa.nombre} la ejecuta el sistema`);
  const asignado = t.asignado_a
    ? await db.selectFrom('usuarios').select('nombre').where('id', '=', t.asignado_a).executeTakeFirst()
    : undefined;
  throw new ErrorNegocio('SIN_PERMISO', `Esta transacción está asignada a ${asignado?.nombre ?? 'otra persona'}: solo esa persona puede actuar en ${etapa.nombre}`);
}

/** Miembros activos del equipo responsable de una etapa: a quiénes se les puede enviar. */
export async function miembrosEtapa(db: BD | Trx, etapa: Pick<Etapa, 'equipo_id'>): Promise<Persona[]> {
  if (!etapa.equipo_id) return [];
  return db
    .selectFrom('usuario_equipo as ue')
    .innerJoin('usuarios as u', 'u.id', 'ue.usuario_id')
    .select(['u.id', 'u.nombre', 'u.email'])
    .where('ue.equipo_id', '=', etapa.equipo_id)
    .where('u.activo', '=', true)
    .orderBy('u.nombre')
    .execute();
}

export interface AreaConMiembros {
  id: number;
  codigo: string;
  nombre: string;
  miembros: Persona[];
}

/** Áreas activas del equipo de una etapa, con sus miembros activos (que además son del equipo). */
export async function areasEtapa(db: BD | Trx, etapa: Pick<Etapa, 'equipo_id'>): Promise<AreaConMiembros[]> {
  if (!etapa.equipo_id) return [];
  const [areas, miembros] = await Promise.all([
    db.selectFrom('areas').select(['id', 'codigo', 'nombre']).where('equipo_id', '=', etapa.equipo_id).where('activa', '=', true).orderBy('nombre').execute(),
    db.selectFrom('usuario_area as ua').innerJoin('areas as a', 'a.id', 'ua.area_id').innerJoin('usuarios as u', 'u.id', 'ua.usuario_id')
      .innerJoin('usuario_equipo as ue', (j) => j.onRef('ue.usuario_id', '=', 'u.id').onRef('ue.equipo_id', '=', 'a.equipo_id'))
      .select(['ua.area_id', 'u.id', 'u.nombre', 'u.email'])
      .where('a.equipo_id', '=', etapa.equipo_id).where('u.activo', '=', true).orderBy('u.nombre').execute(),
  ]);
  return areas.map((a) => ({ ...a, miembros: miembros.filter((m) => m.area_id === a.id).map(({ id, nombre, email }) => ({ id, nombre, email })) }));
}

/**
 * Persona y área a la que se asigna una etapa. Si el equipo tiene áreas, la persona debe ser del
 * área elegida; si no la eligieron y la persona pertenece a una sola área del equipo, se toma esa.
 */
export async function resolverAsignacion(db: BD | Trx, etapa: Etapa, usuarioId: number | undefined, areaId?: number): Promise<{ persona: Persona; areaId: number | null }> {
  const equipo = etapa.equipo_id ? await db.selectFrom('equipos').select('nombre').where('id', '=', etapa.equipo_id).executeTakeFirst() : undefined;
  if (!usuarioId) throw new ErrorNegocio('DATOS_INVALIDOS', `Elige a la persona de ${equipo?.nombre ?? 'el equipo'} que recibe la etapa ${etapa.nombre}`);
  const persona = (await miembrosEtapa(db, etapa)).find((p) => p.id === usuarioId);
  if (!persona) throw new ErrorNegocio('DATOS_INVALIDOS', `La persona elegida no es un usuario activo de ${equipo?.nombre ?? 'el equipo'}, responsable de ${etapa.nombre}`);

  const areas = await areasEtapa(db, etapa);
  if (!areas.length) {
    if (areaId) throw new ErrorNegocio('DATOS_INVALIDOS', `${equipo?.nombre ?? 'El equipo'} no tiene áreas`);
    return { persona, areaId: null };
  }
  const suyas = areas.filter((a) => a.miembros.some((m) => m.id === usuarioId));
  if (areaId) {
    const area = areas.find((a) => a.id === areaId);
    if (!area) throw new ErrorNegocio('DATOS_INVALIDOS', `El área elegida no es un área activa de ${equipo?.nombre ?? 'el equipo'}`);
    if (!suyas.includes(area)) throw new ErrorNegocio('DATOS_INVALIDOS', `${persona.nombre} no pertenece al área ${area.nombre}`);
    return { persona, areaId };
  }
  if (suyas.length === 1) return { persona, areaId: suyas[0]!.id };
  throw new ErrorNegocio('DATOS_INVALIDOS', suyas.length
    ? `Elige el área de ${equipo?.nombre ?? 'el equipo'} a la que va (${persona.nombre} pertenece a varias)`
    : `${persona.nombre} no pertenece a ningún área de ${equipo?.nombre ?? 'el equipo'}: asígnale un área en la administración`);
}

/**
 * Valida a quién (y a qué área) se envía: debe ser del equipo de la etapa destino. En etapas con
 * segregación de funciones nadie se envía una aprobación a sí mismo.
 */
export async function exigirDestinatario(
  db: BD | Trx, destino: Etapa, usuarioId: number | undefined, actor: Actor, areaId?: number,
): Promise<{ persona: Persona; areaId: number | null }> {
  if (destino.segregacion && usuarioId === actor.id) {
    throw new ErrorNegocio('SEGREGACION', `Por segregación de funciones no puedes enviarte a ti mismo la etapa ${destino.nombre}: elige a otra persona`);
  }
  return resolverAsignacion(db, destino, usuarioId, areaId);
}

export async function perteneceA(
  db: BD | Trx, actor: Actor, clave: 'equipos_pueden_anular' | 'equipos_gestionan_facturas' | 'equipos_pueden_reasignar',
) {
  const equipos = await leerConfig(db, clave);
  return actor.equipos.some((e) => equipos.includes(e));
}
