import { sql } from 'kysely';
import type { z } from 'zod';
import type { filtroTransacciones, ItemRequisito } from '@gastos/shared';
import type { BD } from '../db/conexion.js';
import { areasEtapa, esResponsable, miembrosEtapa, perteneceA, type Actor } from './autorizacion.js';
import { ErrorNegocio } from './errores.js';
import { bloqueoPorSegregacion, obtenerEtapa, personaDevolucion, siguienteEtapa } from './flujo.js';
import { evaluarRequisitos, leerRequisitos } from './requisitos.js';

const COLUMNAS_EN_CURSO = [
  'v.id', 'v.consecutivo', 'v.valor', 'v.descripcion', 'v.facturas', 'v.asignado_a', 'v.asignado_nombre', 'v.area_id', 'v.area_nombre',
  'v.etapa_codigo', 'v.etapa_nombre', 'v.etapa_grupo', 'v.sla_dias', 'v.en_etapa_desde',
  'v.dias_habiles_en_etapa', 'v.semaforo', 'v.vencida', 'v.version', 'v.creado_en',
] as const;

/** Bandeja «Mis pendientes»: lo que está asignado al usuario. */
export async function pendientes(db: BD, actor: Actor) {
  return db.selectFrom('v_transacciones_en_curso as v').select([...COLUMNAS_EN_CURSO])
    .where('v.asignado_a', '=', actor.id)
    .orderBy('v.dias_habiles_en_etapa', 'desc').orderBy('v.en_etapa_desde', 'asc')
    .execute();
}

export async function listarTransacciones(db: BD, filtro: z.infer<typeof filtroTransacciones>) {
  let q = db.selectFrom('transacciones as t')
    .innerJoin('catalogo_etapas as e', 'e.id', 't.etapa_actual_id')
    .leftJoin('usuarios as u', 'u.id', 't.asignado_a')
    .leftJoin('areas as ar', 'ar.id', 't.area_id')
    .leftJoin('v_transacciones_en_curso as v', 'v.id', 't.id');
  if (filtro.estado) q = q.where('t.estado', '=', filtro.estado);
  if (filtro.etapa) q = q.where('e.codigo', '=', filtro.etapa);
  if (filtro.areaId) q = q.where('t.area_id', '=', filtro.areaId);
  if (filtro.q) {
    const patron = `%${filtro.q.replace(/[%_\\]/g, '\\$&')}%`;
    q = q.where((eb) => eb.or([
      eb('t.consecutivo', 'ilike', patron),
      eb('t.descripcion', 'ilike', patron),
      eb('u.nombre', 'ilike', patron),
      eb.exists(eb.selectFrom('referencias as r').select(sql`1`.as('x')).whereRef('r.transaccion_id', '=', 't.id').where('r.numero', 'ilike', patron)),
      eb.exists(eb.selectFrom('facturas as f').select(sql`1`.as('x')).whereRef('f.transaccion_id', '=', 't.id')
        .where((x) => x.or([x('f.numero', 'ilike', patron), x('f.proveedor_nombre', 'ilike', patron), x('f.proveedor_nit', 'like', patron)]))),
    ]));
  }

  const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
  const filas = await q
    .select([
      't.id', 't.consecutivo', 't.valor', 't.descripcion', 't.estado', 't.creado_en', 't.cerrado_en', 't.en_etapa_desde',
      'e.codigo as etapa_codigo', 'e.nombre as etapa_nombre', 'e.grupo as etapa_grupo', 'u.nombre as asignado_nombre', 'ar.nombre as area_nombre',
      'v.dias_habiles_en_etapa', 'v.semaforo', 'v.vencida',
      (eb) => eb.selectFrom('facturas as f').select(sql<string>`string_agg(f.numero, ', ' ORDER BY f.id)`.as('n'))
        .whereRef('f.transaccion_id', '=', 't.id').where('f.activa', '=', true).as('facturas'),
    ])
    .orderBy('t.id', 'desc').limit(filtro.porPagina).offset((filtro.pagina - 1) * filtro.porPagina)
    .execute();
  return { total: Number(total.n), pagina: filtro.pagina, porPagina: filtro.porPagina, filas };
}

/** Detalle completo: datos, soportes, historial y lo que el usuario puede hacer ahora. */
export async function detalleTransaccion(db: BD, actor: Actor, id: number) {
  const t = await db.selectFrom('transacciones').selectAll().where('id', '=', id).executeTakeFirst();
  if (!t) throw new ErrorNegocio('NO_ENCONTRADA', 'La transacción no existe');

  const [area, personas, sla, etapa, flujo, referencias, facturas, adjuntos, historial, comentarios] = await Promise.all([
    t.area_id ? db.selectFrom('areas').select(['id', 'nombre']).where('id', '=', t.area_id).executeTakeFirst() : undefined,
    db.selectFrom('usuarios').select(['id', 'nombre', 'email']).where('id', 'in', [t.solicitante_id, t.asignado_a ?? t.solicitante_id]).execute(),
    db.selectFrom('v_transacciones_en_curso').select(['dias_habiles_en_etapa', 'semaforo', 'vencida', 'sla_dias']).where('id', '=', id).executeTakeFirst(),
    obtenerEtapa(db, t.etapa_actual_id),
    db.selectFrom('catalogo_etapas').select(['id', 'codigo', 'nombre', 'grupo', 'orden', 'tipo']).where('activa', '=', true).orderBy('orden').execute(),
    db.selectFrom('referencias as r').innerJoin('usuarios as u', 'u.id', 'r.registrada_por')
      .select(['r.id', 'r.tipo', 'r.numero', 'r.activa', 'r.registrada_en', 'r.inactivada_motivo', 'u.nombre as registrada_por'])
      .where('r.transaccion_id', '=', id).orderBy('r.id').execute(),
    db.selectFrom('facturas as f').innerJoin('usuarios as u', 'u.id', 'f.registrada_por')
      .select(['f.id', 'f.numero', 'f.proveedor_nit', 'f.proveedor_nombre', 'f.fecha', 'f.valor', 'f.cufe', 'f.adjunto_id', 'f.xml_adjunto_id',
        'f.activa', 'f.inactivada_motivo', 'f.registrada_en', 'u.nombre as registrada_por'])
      .where('f.transaccion_id', '=', id).orderBy('f.id').execute(),
    db.selectFrom('adjuntos as a').innerJoin('usuarios as u', 'u.id', 'a.subido_por').innerJoin('catalogo_etapas as e', 'e.id', 'a.etapa_id')
      .select(['a.id', 'a.tipo', 'a.nombre_original', 'a.mime', 'a.tamano_bytes', 'a.sha256', 'a.activo', 'a.inactivado_motivo',
        'a.subido_en', 'u.nombre as subido_por', 'e.codigo as etapa_codigo', 'e.nombre as etapa_nombre'])
      .where('a.transaccion_id', '=', id).orderBy('a.id').execute(),
    db.selectFrom('eventos as ev')
      .leftJoin('usuarios as u', 'u.id', 'ev.actor_id')
      .leftJoin('catalogo_etapas as o', 'o.id', 'ev.etapa_origen_id')
      .leftJoin('catalogo_etapas as d', 'd.id', 'ev.etapa_destino_id')
      .select(['ev.id', 'ev.tipo', 'ev.motivo', 'ev.datos', 'ev.ocurrido_en', 'u.nombre as actor',
        'o.codigo as origen_codigo', 'o.nombre as origen_nombre', 'd.codigo as destino_codigo', 'd.nombre as destino_nombre'])
      .where('ev.transaccion_id', '=', id).orderBy('ev.id').execute(),
    db.selectFrom('comentarios as c').innerJoin('usuarios as u', 'u.id', 'c.autor_id').innerJoin('catalogo_etapas as e', 'e.id', 'c.etapa_id')
      .select(['c.id', 'c.texto', 'c.creado_en', 'u.nombre as autor', 'e.codigo as etapa_codigo'])
      .where('c.transaccion_id', '=', id).orderBy('c.id').execute(),
  ]);

  const enCurso = t.estado === 'en_curso';
  const actuable = enCurso && etapa.tipo !== 'sistema';
  const responsable = esResponsable(actor, t, etapa);
  const segregacion = responsable ? await bloqueoPorSegregacion(db, actor.id, t, etapa) : null;
  const requisitos: ItemRequisito[] = actuable ? await evaluarRequisitos(db, t, etapa) : [];
  const siguiente = actuable ? await siguienteEtapa(db, etapa) : undefined;
  const req = actuable ? leerRequisitos(etapa) : undefined;
  const puedeReasignar = actuable && (t.asignado_a === actor.id || (await perteneceA(db, actor, 'equipos_pueden_reasignar')));
  const devolucion = responsable && etapa.etapa_devolucion_id ? await obtenerEtapa(db, etapa.etapa_devolucion_id) : undefined;

  // A quién se puede enviar: miembros del equipo siguiente, por área si el equipo las tiene (sin uno mismo si hay segregación)
  const sinUnoMismo = <P extends { id: number }>(l: P[]) => l.filter((p) => !(siguiente?.segregacion && p.id === actor.id));
  const destino = responsable && siguiente && siguiente.tipo !== 'sistema'
    ? { miembros: sinUnoMismo(await miembrosEtapa(db, siguiente)),
        areas: (await areasEtapa(db, siguiente)).map((a) => ({ ...a, miembros: sinUnoMismo(a.miembros) })).filter((a) => a.miembros.length) }
    : { miembros: [], areas: [] };
  const reasignacion = puedeReasignar
    ? { miembros: (await miembrosEtapa(db, etapa)).filter((p) => p.id !== t.asignado_a), areas: await areasEtapa(db, etapa) }
    : { miembros: [], areas: [] };
  const persona = (pid: number | null) => personas.find((p) => p.id === pid) ?? null;

  return {
    transaccion: { ...t, ...(sla ?? {}), solicitante: persona(t.solicitante_id), asignado: persona(t.asignado_a), area: area ?? null },
    etapa: { id: etapa.id, codigo: etapa.codigo, nombre: etapa.nombre, grupo: etapa.grupo, tipo: etapa.tipo, descripcion: etapa.descripcion,
      referencia: req?.referencias[0] ?? null, documentos: req?.adjuntos ?? [] },
    siguiente: siguiente ? { codigo: siguiente.codigo, nombre: siguiente.nombre, tipo: siguiente.tipo } : null,
    flujo,
    requisitos,
    acciones: {
      avanzar: responsable && !segregacion,
      devolver: responsable && !!devolucion,
      anular: enCurso && (await perteneceA(db, actor, 'equipos_pueden_anular')),
      reasignar: puedeReasignar && reasignacion.miembros.length > 0,
      registrarFacturas: enCurso && (await perteneceA(db, actor, 'equipos_gestionan_facturas')),
      adjuntar: actuable && (responsable || (await perteneceA(db, actor, 'equipos_gestionan_facturas'))),
      // En aprobación se habla de aprobar / rechazar (decisión 1)
      etiquetaAvanzar: etapa.tipo === 'aprobacion' ? 'Aprobar' : siguiente?.tipo === 'sistema' ? 'Registrar y cerrar' : 'Enviar',
      etiquetaDevolver: etapa.tipo === 'aprobacion' ? 'Rechazar' : 'Devolver',
      comentarioObligatorio: req?.comentario_obligatorio ?? false,
      bloqueoSegregacion: segregacion ? `Ejecutaste la etapa ${segregacion}; por segregación de funciones otra persona debe continuar.` : null,
      destino,
      devolverA: devolucion ? { etapa: devolucion.nombre, persona: (await personaDevolucion(db, t, devolucion))?.nombre ?? null } : null,
      reasignacion,
    },
    referencias,
    facturas,
    adjuntos,
    historial,
    comentarios,
  };
}

/** Datos para los formularios: etapas activas y, para cada una, a quién se le puede asignar. */
export async function catalogos(db: BD) {
  const etapas = await db.selectFrom('catalogo_etapas').select(['id', 'codigo', 'nombre', 'grupo', 'orden', 'tipo', 'sla_dias', 'equipo_id', 'requisitos'])
    .where('activa', '=', true).orderBy('orden').execute();
  return {
    etapas: await Promise.all(etapas.map(async (e) => ({ ...e, miembros: await miembrosEtapa(db, e), areas: await areasEtapa(db, e) }))),
    areas: await db.selectFrom('areas as a').innerJoin('equipos as q', 'q.id', 'a.equipo_id')
      .select(['a.id', 'a.codigo', 'a.nombre', 'q.nombre as equipo']).where('a.activa', '=', true).orderBy('q.nombre').orderBy('a.nombre').execute(),
  };
}
