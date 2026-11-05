// Máquina de estados del gasto. Cada acción ocurre en UNA transacción de base de datos:
// bloquea la fila, valida, registra el evento de auditoría, actualiza el estado y publica en
// el outbox. Si algo falla, no queda nada a medias (la base de datos además lo verifica al COMMIT).
//
// Cada transacción está asignada a una persona. Quien completa una etapa elige a quién se la
// envía, entre los miembros del equipo de la etapa siguiente.
import { ADJUNTO_SOPORTE_ADICIONAL, type CrearSolicitud } from '@gastos/shared';
import type { BD, Trx } from '../db/conexion.js';
import type { Etapa, Transaccion } from '../db/esquema.js';
import type { Almacenamiento } from '../servicios/almacenamiento.js';
import { eventoSoporte, insertarAdjunto, subir, validarArchivo, type ArchivoEntrante, type ArchivoValidado } from './archivos.js';
import { exigirDestinatario, exigirResponsable, miembrosEtapa, perteneceA, resolverAsignacion, type Actor, type Persona } from './autorizacion.js';
import { ErrorNegocio } from './errores.js';
import { insertarFactura, prepararFacturas, type FacturaEntrante } from './facturas.js';
import { emitirOutbox } from './outbox.js';
import { evaluarRequisitos, leerRequisitos } from './requisitos.js';

export interface ContextoFlujo {
  db: BD;
  appUrl: string;
  almacenamiento: Almacenamiento;
}

// ---------------------------------------------------------------------------
// Consultas de apoyo
// ---------------------------------------------------------------------------

export async function bloquearTransaccion(trx: Trx, id: number): Promise<Transaccion> {
  const t = await trx.selectFrom('transacciones').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!t) throw new ErrorNegocio('NO_ENCONTRADA', 'La transacción no existe');
  return t;
}

export async function leerTransaccion(db: BD | Trx, id: number): Promise<Transaccion> {
  const t = await db.selectFrom('transacciones').selectAll().where('id', '=', id).executeTakeFirst();
  if (!t) throw new ErrorNegocio('NO_ENCONTRADA', 'La transacción no existe');
  return t;
}

export function exigirEnCurso(t: Transaccion, versionVista?: number) {
  if (t.estado !== 'en_curso') {
    throw new ErrorNegocio('TRANSACCION_CERRADA', `La transacción ${t.consecutivo} está ${t.estado} y ya no admite cambios`);
  }
  if (versionVista !== undefined && versionVista !== t.version) {
    throw new ErrorNegocio('VERSION_DESACTUALIZADA',
      `La transacción ${t.consecutivo} cambió mientras la revisabas. Recarga la página para ver su estado actual.`);
  }
}

export async function obtenerEtapa(db: BD | Trx, id: number): Promise<Etapa> {
  const e = await db.selectFrom('catalogo_etapas').selectAll().where('id', '=', id).executeTakeFirst();
  if (!e) throw new ErrorNegocio('CONFIGURACION_INVALIDA', `La etapa ${id} no existe en el catálogo`);
  return e;
}

/** Siguiente etapa activa según `orden`. El flujo es secuencial: no hay saltos. */
export async function siguienteEtapa(db: BD | Trx, etapa: Etapa): Promise<Etapa | undefined> {
  return db.selectFrom('catalogo_etapas').selectAll()
    .where('activa', '=', true).where('orden', '>', etapa.orden).orderBy('orden').limit(1).executeTakeFirst();
}

export async function primeraEtapa(db: BD | Trx): Promise<Etapa> {
  const e = await db.selectFrom('catalogo_etapas').selectAll().where('activa', '=', true).orderBy('orden').limit(1).executeTakeFirst();
  if (!e || e.tipo === 'sistema') throw new ErrorNegocio('CONFIGURACION_INVALIDA', 'El catálogo no tiene una etapa inicial válida');
  return e;
}

/**
 * Segregación de funciones: quien llevó la transacción a esta etapa (ejecutó la etapa
 * inmediatamente anterior) no puede aprobarla. Devuelve el código de la etapa que ejecutó.
 */
export async function bloqueoPorSegregacion(db: BD | Trx, usuarioId: number, t: Transaccion, etapa: Etapa): Promise<string | null> {
  if (!etapa.segregacion) return null;
  const entrada = await db.selectFrom('eventos as e').innerJoin('catalogo_etapas as o', 'o.id', 'e.etapa_origen_id')
    .select(['e.actor_id', 'o.codigo as origen'])
    .where('e.transaccion_id', '=', t.id).where('e.tipo', '=', 'avanzada').where('e.etapa_destino_id', '=', etapa.id)
    .orderBy('e.id', 'desc').limit(1).executeTakeFirst();
  return entrada?.actor_id === usuarioId ? entrada.origen : null;
}

/** A quién vuelve una devolución: a quien completó esa etapa la última vez, si sigue en su equipo. */
export async function personaDevolucion(db: BD | Trx, t: Transaccion, destino: Etapa): Promise<Persona | undefined> {
  const miembros = await miembrosEtapa(db, destino);
  const ultimo = await db.selectFrom('eventos').select('actor_id')
    .where('transaccion_id', '=', t.id).where('tipo', '=', 'avanzada').where('etapa_origen_id', '=', destino.id)
    .orderBy('id', 'desc').limit(1).executeTakeFirst();
  return miembros.find((m) => m.id === ultimo?.actor_id) ?? miembros.find((m) => m.id === t.solicitante_id) ?? miembros[0];
}

async function registrarEvento(
  trx: Trx,
  e: { transaccionId: number; tipo: 'avanzada' | 'devuelta' | 'anulada' | 'cerrada' | 'reasignada'; origen: number | null; destino: number | null;
       actorId: number | null; motivo?: string | null; datos?: Record<string, unknown> },
): Promise<number> {
  const fila = await trx.insertInto('eventos')
    .values({ transaccion_id: e.transaccionId, tipo: e.tipo, etapa_origen_id: e.origen, etapa_destino_id: e.destino,
      actor_id: e.actorId, motivo: e.motivo ?? null, datos: JSON.stringify(e.datos ?? {}) })
    .returning('id').executeTakeFirstOrThrow();
  return fila.id;
}

/** Tipo de adjunto que se guarda con el archivo de la etapa: el primero que aún falta, o el primero. */
async function tipoDocumentoEtapa(db: BD | Trx, t: Transaccion, etapa: Etapa): Promise<string> {
  const req = leerRequisitos(etapa);
  if (!req.adjuntos.length) throw new ErrorNegocio('DATOS_INVALIDOS', `La etapa ${etapa.nombre} no pide documentos`);
  const faltante = (await evaluarRequisitos(db, t, etapa)).find((i) => i.clave.startsWith('adjunto:') && !i.cumple);
  return faltante ? faltante.clave.slice('adjunto:'.length) : req.adjuntos[0]!.tipo;
}

/** Registra (o reemplaza) el número de la etapa. Único por tipo en todo el sistema. */
export async function registrarReferenciaEnTx(trx: Trx, actor: Actor, t: Transaccion, etapa: Etapa, numero: string) {
  const req = leerRequisitos(etapa);
  const tipo = req.referencias[0]?.tipo;
  if (!tipo) throw new ErrorNegocio('DATOS_INVALIDOS', `En la etapa ${etapa.nombre} no se registra ningún número`);
  const limpio = numero.trim();
  const otra = await trx.selectFrom('referencias as r').innerJoin('transacciones as t', 't.id', 'r.transaccion_id')
    .select('t.consecutivo')
    .where('r.activa', '=', true).where('r.tipo', '=', tipo).where('r.transaccion_id', '!=', t.id)
    .where((eb) => eb(eb.fn('upper', ['r.numero']), '=', limpio.toUpperCase()))
    .executeTakeFirst();
  if (otra) throw new ErrorNegocio('REFERENCIA_DUPLICADA', `El número de ${tipo} ${limpio} ya está registrado en ${otra.consecutivo}`);
  const vigente = await trx.selectFrom('referencias').select('numero')
    .where('transaccion_id', '=', t.id).where('tipo', '=', tipo).where('activa', '=', true).executeTakeFirst();
  if (vigente?.numero === limpio) return; // ya estaba registrado (p. ej. al reenviar tras una devolución)
  const anterior = await trx.updateTable('referencias')
    .set({ activa: false, inactivada_en: new Date(), inactivada_motivo: 'reemplazo' })
    .where('transaccion_id', '=', t.id).where('tipo', '=', tipo).where('activa', '=', true)
    .returning('numero').executeTakeFirst();
  await trx.insertInto('referencias').values({ transaccion_id: t.id, tipo, numero: limpio, etapa_id: etapa.id, registrada_por: actor.id }).execute();
  await eventoSoporte(trx, t.id, etapa.id, actor.id, 'referencia_registrada', { tipo, numero: limpio, reemplaza: anterior?.numero ?? null });
}

async function nombreArea(db: BD | Trx, areaId: number | null) {
  return areaId ? db.selectFrom('areas').select(['id', 'nombre']).where('id', '=', areaId).executeTakeFirst() : undefined;
}

/**
 * Pasa la transacción (ya bloqueada) a la siguiente etapa y se la asigna a `asignarA`.
 * Si la siguiente es la del sistema, la cierra como pagada.
 */
async function moverAdelante(
  trx: Trx, ctx: ContextoFlujo, actor: Actor, t: Transaccion, etapa: Etapa, datos: { asignarA?: number; areaId?: number; comentario?: string },
): Promise<Transaccion> {
  const faltantes = (await evaluarRequisitos(trx, t, etapa, datos.comentario)).filter((i) => !i.cumple);
  if (faltantes.length) {
    throw new ErrorNegocio('REQUISITOS_INCOMPLETOS',
      `Para completar ${etapa.nombre} falta: ${faltantes.map((f) => f.descripcion.toLowerCase()).join('; ')}`, faltantes);
  }
  const destino = await siguienteEtapa(trx, etapa);
  if (!destino) throw new ErrorNegocio('CONFIGURACION_INVALIDA', `No hay una etapa activa después de ${etapa.codigo}`);
  const asignacion = destino.tipo === 'sistema' ? null : await exigirDestinatario(trx, destino, datos.asignarA, actor, datos.areaId);
  const persona = asignacion?.persona ?? null;
  const area = await nombreArea(trx, asignacion?.areaId ?? null);

  const comentario = datos.comentario?.trim() || null;
  const eventoId = await registrarEvento(trx, {
    transaccionId: t.id, tipo: 'avanzada', origen: etapa.id, destino: destino.id, actorId: actor.id,
    datos: { comentario, asignado_a: persona?.id ?? null, asignado: persona?.nombre ?? null, area_id: area?.id ?? null, area: area?.nombre ?? null,
      ...(etapa.tipo === 'aprobacion' ? { decision: 'aprobado' } : {}) },
  });
  let actual = await trx.updateTable('transacciones')
    .set((eb) => ({ etapa_actual_id: destino.id, asignado_a: persona?.id ?? null, area_id: area?.id ?? null, en_etapa_desde: new Date(), version: eb('version', '+', 1) }))
    .where('id', '=', t.id).returningAll().executeTakeFirstOrThrow();
  await emitirOutbox(trx, { tipo: 'transaccion.avanzada', eventoId, t: actual, origen: etapa, destino, actor, comentario, appUrl: ctx.appUrl });

  // Etapa del sistema (FT): cierre automático como pagada
  if (destino.tipo === 'sistema') {
    if (await siguienteEtapa(trx, destino)) {
      throw new ErrorNegocio('CONFIGURACION_INVALIDA', `La etapa del sistema ${destino.codigo} debe ser la última del flujo`);
    }
    const cierreId = await registrarEvento(trx, { transaccionId: t.id, tipo: 'cerrada', origen: destino.id, destino: destino.id, actorId: null, datos: { estado: 'pagada' } });
    actual = await trx.updateTable('transacciones')
      .set((eb) => ({ estado: 'pagada', cerrado_en: new Date(), version: eb('version', '+', 1) }))
      .where('id', '=', t.id).returningAll().executeTakeFirstOrThrow();
    await emitirOutbox(trx, { tipo: 'transaccion.cerrada', eventoId: cierreId, t: actual, origen: destino, destino, actor: null, appUrl: ctx.appUrl });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

/** Valida y sube soportes adicionales (pantallazos, fotos, PDF) antes de abrir la transacción de BD. */
async function prepararSoportes(ctx: ContextoFlujo, carpeta: string, archivos: ArchivoEntrante[]) {
  const listos: { archivo: ArchivoValidado; clave: string }[] = [];
  for (const a of archivos) {
    const archivo = await validarArchivo(ctx.db, a);
    listos.push({ archivo, clave: await subir(ctx.almacenamiento, carpeta, archivo) });
  }
  return listos;
}

async function insertarSoportes(
  trx: Trx, ctx: ContextoFlujo, actor: Actor, t: Transaccion, etapaId: number, tipo: string, listos: { archivo: ArchivoValidado; clave: string }[],
) {
  for (const s of listos) {
    const a = await insertarAdjunto(trx, ctx.almacenamiento.bucket, actor, t.id, etapaId, tipo, s.archivo, s.clave);
    await eventoSoporte(trx, t.id, etapaId, actor.id, 'adjunto_agregado', { adjunto_id: a.id, tipo: a.tipo, nombre: a.nombre_original });
  }
}

/**
 * Nueva solicitud: una o varias facturas (cada una con su PDF y, si lo hay, el XML/ZIP de la
 * DIAN, y su número), soportes adicionales opcionales y a quién se envía. En un solo paso queda
 * creada en la primera etapa y enviada a la siguiente.
 */
export async function crearSolicitud(
  ctx: ContextoFlujo, actor: Actor, datos: CrearSolicitud, facturas: FacturaEntrante[], soportes: ArchivoEntrante[] = [],
): Promise<Transaccion> {
  const etapa = await primeraEtapa(ctx.db);
  const equipo = await ctx.db.selectFrom('equipos').select(['codigo', 'nombre']).where('id', '=', etapa.equipo_id!).executeTakeFirstOrThrow();
  if (!actor.equipos.includes(equipo.codigo)) throw new ErrorNegocio('SIN_PERMISO', `Solo ${equipo.nombre} crea solicitudes de gasto`);
  const destino = await siguienteEtapa(ctx.db, etapa);
  if (destino && destino.tipo !== 'sistema') await exigirDestinatario(ctx.db, destino, datos.asignarA, actor, datos.areaId);
  if (!facturas.length) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Adjunta al menos una factura');

  const preparadas = await prepararFacturas(ctx.db, ctx.almacenamiento, facturas);
  const listos = await prepararSoportes(ctx, 'soportes', soportes);
  // Sin valor escrito: la suma de lo leído en los XML, si todas las facturas lo traen
  const valores = preparadas.map((f) => f.datos.valor);
  const valorFacturas = valores.every(Boolean) ? valores.reduce((s, v) => s + Number(v), 0).toFixed(2) : null;

  return ctx.db.transaction().execute(async (trx) => {
    const creada = await trx.insertInto('transacciones')
      .values({
        valor: datos.valor || valorFacturas,
        descripcion: datos.descripcion || null,
        etapa_actual_id: etapa.id,
        solicitante_id: actor.id,
        asignado_a: actor.id,
      })
      .returningAll().executeTakeFirstOrThrow();
    await trx.insertInto('eventos')
      .values({ transaccion_id: creada.id, tipo: 'creada', etapa_destino_id: etapa.id, actor_id: actor.id, datos: JSON.stringify({}) })
      .execute();
    for (const f of preparadas) await insertarFactura(trx, ctx.almacenamiento.bucket, actor, creada.id, etapa.id, f);
    await insertarSoportes(trx, ctx, actor, creada, etapa.id, ADJUNTO_SOPORTE_ADICIONAL, listos);
    return moverAdelante(trx, ctx, actor, creada, etapa, { asignarA: datos.asignarA, areaId: datos.areaId, comentario: datos.comentario });
  });
}

/**
 * Completa la etapa actual y la envía a la siguiente: registra su número y sus documentos (si la
 * etapa los pide; pueden ser varios), soportes adicionales opcionales, valida los requisitos y la
 * asigna a la persona elegida. En aprobaciones es «aprobar».
 */
export async function avanzar(
  ctx: ContextoFlujo, actor: Actor, transaccionId: number,
  datos: { version: number; asignarA?: number; areaId?: number; numero?: string; comentario?: string },
  documentos: ArchivoEntrante[] = [], soportes: ArchivoEntrante[] = [],
): Promise<Transaccion> {
  // Los archivos se validan y se suben antes de abrir la transacción de base de datos
  let docs: { archivo: ArchivoValidado; clave: string }[] = [];
  let extra: { archivo: ArchivoValidado; clave: string }[] = [];
  let tipoDocumento: string | undefined;
  if (documentos.length || soportes.length) {
    const t = await leerTransaccion(ctx.db, transaccionId);
    exigirEnCurso(t, datos.version);
    const etapa = await obtenerEtapa(ctx.db, t.etapa_actual_id);
    await exigirResponsable(ctx.db, actor, t, etapa);
    const carpeta = `transacciones/${t.consecutivo}/${etapa.codigo}`;
    if (documentos.length) tipoDocumento = await tipoDocumentoEtapa(ctx.db, t, etapa);
    docs = await prepararSoportes(ctx, carpeta, documentos);
    extra = await prepararSoportes(ctx, carpeta, soportes);
  }

  return ctx.db.transaction().execute(async (trx) => {
    const t = await bloquearTransaccion(trx, transaccionId);
    exigirEnCurso(t, datos.version);
    const etapa = await obtenerEtapa(trx, t.etapa_actual_id);
    await exigirResponsable(trx, actor, t, etapa);
    const ejecutada = await bloqueoPorSegregacion(trx, actor.id, t, etapa);
    if (ejecutada) {
      throw new ErrorNegocio('SEGREGACION',
        `Tú ejecutaste la etapa ${ejecutada} de esta transacción. Por segregación de funciones, otra persona debe ${etapa.tipo === 'aprobacion' ? 'aprobar' : 'ejecutar'} la etapa ${etapa.nombre}.`);
    }
    if (datos.numero) await registrarReferenciaEnTx(trx, actor, t, etapa, datos.numero);
    if (tipoDocumento) await insertarSoportes(trx, ctx, actor, t, etapa.id, tipoDocumento, docs);
    await insertarSoportes(trx, ctx, actor, t, etapa.id, ADJUNTO_SOPORTE_ADICIONAL, extra);
    return moverAdelante(trx, ctx, actor, t, etapa, { asignarA: datos.asignarA, areaId: datos.areaId, comentario: datos.comentario });
  });
}

/**
 * Devuelve a la etapa configurada en `etapa_devolucion_id` (por defecto la anterior), con
 * motivo. Vuelve a quien la había enviado desde esa etapa. En aprobaciones es «rechazar».
 */
export async function devolver(ctx: ContextoFlujo, actor: Actor, transaccionId: number, datos: { version: number; motivo: string }): Promise<Transaccion> {
  return ctx.db.transaction().execute(async (trx) => {
    const t = await bloquearTransaccion(trx, transaccionId);
    exigirEnCurso(t, datos.version);
    const etapa = await obtenerEtapa(trx, t.etapa_actual_id);
    await exigirResponsable(trx, actor, t, etapa);
    if (!etapa.etapa_devolucion_id) throw new ErrorNegocio('DEVOLUCION_NO_PERMITIDA', `La etapa ${etapa.nombre} no admite devolución`);
    const destino = await obtenerEtapa(trx, etapa.etapa_devolucion_id);
    const persona = await personaDevolucion(trx, t, destino);
    if (!persona) throw new ErrorNegocio('CONFIGURACION_INVALIDA', `No hay usuarios activos en el equipo de ${destino.nombre} para recibir la devolución`);
    const motivo = datos.motivo.trim();
    // Vuelve al área en la que estuvo en esa etapa (si sigue siendo válida para la persona)
    const previa = await trx.selectFrom('eventos').select('datos').where('transaccion_id', '=', t.id)
      .where('etapa_destino_id', '=', destino.id).where('tipo', 'in', ['avanzada', 'devuelta', 'reasignada']).orderBy('id', 'desc').limit(1).executeTakeFirst();
    const areaPrevia = Number((previa?.datos as { area_id?: number } | undefined)?.area_id) || undefined;
    const asignacion = await resolverAsignacion(trx, destino, persona.id, areaPrevia).catch(() => resolverAsignacion(trx, destino, persona.id));
    const area = await nombreArea(trx, asignacion.areaId);

    const eventoId = await registrarEvento(trx, {
      transaccionId: t.id, tipo: 'devuelta', origen: etapa.id, destino: destino.id, actorId: actor.id, motivo,
      datos: { asignado_a: persona.id, asignado: persona.nombre, area_id: area?.id ?? null, area: area?.nombre ?? null,
        ...(etapa.tipo === 'aprobacion' ? { decision: 'rechazado' } : {}) },
    });
    const actual = await trx.updateTable('transacciones')
      .set((eb) => ({ etapa_actual_id: destino.id, asignado_a: persona.id, area_id: area?.id ?? null, en_etapa_desde: new Date(), version: eb('version', '+', 1) }))
      .where('id', '=', t.id).returningAll().executeTakeFirstOrThrow();
    await emitirOutbox(trx, { tipo: 'transaccion.devuelta', eventoId, t: actual, origen: etapa, destino, actor, motivo, appUrl: ctx.appUrl });
    return actual;
  });
}

/**
 * Pasa la transacción a otra persona del mismo equipo (vacaciones, ausencias). Puede hacerlo la
 * persona asignada, o contabilidad y el administrador (configurable).
 */
export async function reasignar(
  ctx: ContextoFlujo, actor: Actor, transaccionId: number, datos: { version: number; usuarioId: number; areaId?: number; motivo?: string },
): Promise<Transaccion> {
  return ctx.db.transaction().execute(async (trx) => {
    const t = await bloquearTransaccion(trx, transaccionId);
    exigirEnCurso(t, datos.version);
    const etapa = await obtenerEtapa(trx, t.etapa_actual_id);
    if (t.asignado_a !== actor.id && !(await perteneceA(trx, actor, 'equipos_pueden_reasignar'))) {
      throw new ErrorNegocio('SIN_PERMISO', 'Solo la persona asignada, contabilidad o el administrador pueden reasignar');
    }
    const { persona, areaId } = await resolverAsignacion(trx, etapa, datos.usuarioId, datos.areaId);
    if (persona.id === t.asignado_a && areaId === t.area_id) throw new ErrorNegocio('DATOS_INVALIDOS', 'La transacción ya está asignada a esa persona');
    const area = await nombreArea(trx, areaId);
    const ejecutada = await bloqueoPorSegregacion(trx, persona.id, t, etapa);
    if (ejecutada) throw new ErrorNegocio('SEGREGACION', `${persona.nombre} ejecutó la etapa ${ejecutada}: por segregación de funciones no puede recibir ${etapa.nombre}`);

    const anterior = t.asignado_a ? await trx.selectFrom('usuarios').select('nombre').where('id', '=', t.asignado_a).executeTakeFirst() : undefined;
    const eventoId = await registrarEvento(trx, {
      transaccionId: t.id, tipo: 'reasignada', origen: etapa.id, destino: etapa.id, actorId: actor.id, motivo: datos.motivo ?? null,
      datos: { de: anterior?.nombre ?? null, asignado_a: persona.id, asignado: persona.nombre, area_id: area?.id ?? null, area: area?.nombre ?? null },
    });
    // La antigüedad en la etapa (SLA) no se reinicia al reasignar
    const actual = await trx.updateTable('transacciones')
      .set((eb) => ({ asignado_a: persona.id, area_id: area?.id ?? null, version: eb('version', '+', 1) }))
      .where('id', '=', t.id).returningAll().executeTakeFirstOrThrow();
    await emitirOutbox(trx, { tipo: 'transaccion.reasignada', eventoId, t: actual, origen: etapa, destino: etapa, actor, motivo: datos.motivo, appUrl: ctx.appUrl });
    return actual;
  });
}

/** Solo contabilidad o administrador (configurable), con motivo. Libera facturas y referencias. */
export async function anular(ctx: ContextoFlujo, actor: Actor, transaccionId: number, datos: { version: number; motivo: string }): Promise<Transaccion> {
  return ctx.db.transaction().execute(async (trx) => {
    const t = await bloquearTransaccion(trx, transaccionId);
    exigirEnCurso(t, datos.version);
    if (!(await perteneceA(trx, actor, 'equipos_pueden_anular'))) {
      throw new ErrorNegocio('SIN_PERMISO', 'Solo contabilidad o un administrador pueden anular una transacción');
    }
    const etapa = await obtenerEtapa(trx, t.etapa_actual_id);
    const motivo = datos.motivo.trim();
    const eventoId = await registrarEvento(trx, { transaccionId: t.id, tipo: 'anulada', origen: etapa.id, destino: null, actorId: actor.id, motivo });
    const actual = await trx.updateTable('transacciones')
      .set((eb) => ({ estado: 'anulada', asignado_a: null, cerrado_en: new Date(), version: eb('version', '+', 1) }))
      .where('id', '=', t.id).returningAll().executeTakeFirstOrThrow();
    await emitirOutbox(trx, { tipo: 'transaccion.anulada', eventoId, t: actual, origen: etapa, destino: null, actor, motivo, teniaAsignadoId: t.asignado_a, appUrl: ctx.appUrl });
    return actual;
  });
}
