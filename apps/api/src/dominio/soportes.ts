// Soportes adicionales de una transacción en curso: más facturas, soportes sueltos, retiros por
// error y comentarios. Lo habitual (número + documento de la etapa) va con `avanzar`.
import { ADJUNTO_FACTURA, ADJUNTO_FACTURA_XML, ADJUNTO_SOPORTE_ADICIONAL } from '@gastos/shared';
import type { MotivoInactivacion } from '../db/esquema.js';
import { eventoSoporte, insertarAdjunto, subir, validarArchivo, type ArchivoEntrante } from './archivos.js';
import { exigirResponsable, perteneceA, type Actor } from './autorizacion.js';
import { ErrorNegocio } from './errores.js';
import { insertarFactura, prepararFacturas, type FacturaEntrante } from './facturas.js';
import { bloquearTransaccion, exigirEnCurso, leerTransaccion, obtenerEtapa, type ContextoFlujo } from './flujo.js';

export type { ArchivoEntrante };

/** Contabilidad agrega una o varias facturas en cualquier etapa en curso. */
export async function registrarFacturas(ctx: ContextoFlujo, actor: Actor, transaccionId: number, facturas: FacturaEntrante[]) {
  exigirEnCurso(await leerTransaccion(ctx.db, transaccionId));
  if (!(await perteneceA(ctx.db, actor, 'equipos_gestionan_facturas'))) {
    throw new ErrorNegocio('SIN_PERMISO', 'Solo contabilidad puede registrar facturas');
  }
  if (!facturas.length) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Adjunta al menos una factura');
  const preparadas = await prepararFacturas(ctx.db, ctx.almacenamiento, facturas);
  return ctx.db.transaction().execute(async (trx) => {
    const t = await bloquearTransaccion(trx, transaccionId);
    exigirEnCurso(t);
    const registradas = [];
    for (const f of preparadas) registradas.push(await insertarFactura(trx, ctx.almacenamiento.bucket, actor, t.id, t.etapa_actual_id, f));
    return registradas;
  });
}

export async function inactivarFactura(ctx: ContextoFlujo, actor: Actor, facturaId: number, motivo: Exclude<MotivoInactivacion, 'anulacion'>) {
  return ctx.db.transaction().execute(async (trx) => {
    const f = await trx.selectFrom('facturas').selectAll().where('id', '=', facturaId).executeTakeFirst();
    if (!f || !f.activa) throw new ErrorNegocio('NO_ENCONTRADA', 'La factura no existe o ya está inactiva');
    const t = await bloquearTransaccion(trx, f.transaccion_id);
    exigirEnCurso(t);
    if (!(await perteneceA(trx, actor, 'equipos_gestionan_facturas'))) throw new ErrorNegocio('SIN_PERMISO', 'Solo contabilidad puede retirar facturas');
    const ahora = new Date();
    await trx.updateTable('facturas').set({ activa: false, inactivada_en: ahora, inactivada_motivo: motivo }).where('id', '=', f.id).execute();
    const adjuntos = [f.adjunto_id, ...(f.xml_adjunto_id ? [f.xml_adjunto_id] : [])];
    await trx.updateTable('adjuntos').set({ activo: false, inactivado_en: ahora, inactivado_motivo: motivo }).where('id', 'in', adjuntos).execute();
    await eventoSoporte(trx, t.id, t.etapa_actual_id, actor.id, 'factura_inactivada', { factura_id: f.id, numero: f.numero, motivo });
  });
}

/** La persona asignada (o contabilidad) agrega soportes adicionales a la etapa actual: pantallazos, fotos, PDF. */
export async function registrarAdjuntos(ctx: ContextoFlujo, actor: Actor, transaccionId: number, archivos: ArchivoEntrante[]) {
  const previa = await leerTransaccion(ctx.db, transaccionId);
  exigirEnCurso(previa);
  const etapa = await obtenerEtapa(ctx.db, previa.etapa_actual_id);
  if (previa.asignado_a !== actor.id && !(await perteneceA(ctx.db, actor, 'equipos_gestionan_facturas'))) {
    await exigirResponsable(ctx.db, actor, previa, etapa);
  }
  if (!archivos.length) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Adjunta al menos un archivo');
  const listos: { validado: Awaited<ReturnType<typeof validarArchivo>>; clave: string }[] = [];
  for (const archivo of archivos) {
    const validado = await validarArchivo(ctx.db, archivo);
    listos.push({ validado, clave: await subir(ctx.almacenamiento, `transacciones/${previa.consecutivo}/${etapa.codigo}`, validado) });
  }
  return ctx.db.transaction().execute(async (trx) => {
    const t = await bloquearTransaccion(trx, transaccionId);
    exigirEnCurso(t);
    if (t.etapa_actual_id !== etapa.id) throw new ErrorNegocio('VERSION_DESACTUALIZADA', 'La transacción cambió de etapa mientras cargabas los archivos. Recarga la página.');
    const registrados = [];
    for (const { validado, clave } of listos) {
      const a = await insertarAdjunto(trx, ctx.almacenamiento.bucket, actor, t.id, etapa.id, ADJUNTO_SOPORTE_ADICIONAL, validado, clave);
      await eventoSoporte(trx, t.id, etapa.id, actor.id, 'adjunto_agregado', { adjunto_id: a.id, tipo: a.tipo, nombre: a.nombre_original });
      registrados.push(a);
    }
    return registrados;
  });
}

/** Retira un adjunto de la etapa actual (subido por error). Las facturas se retiran como factura. */
export async function inactivarAdjunto(ctx: ContextoFlujo, actor: Actor, adjuntoId: number, motivo: Exclude<MotivoInactivacion, 'anulacion'>) {
  return ctx.db.transaction().execute(async (trx) => {
    const a = await trx.selectFrom('adjuntos').selectAll().where('id', '=', adjuntoId).executeTakeFirst();
    if (!a || !a.activo) throw new ErrorNegocio('NO_ENCONTRADA', 'El adjunto no existe o ya está inactivo');
    if (a.tipo === ADJUNTO_FACTURA || a.tipo === ADJUNTO_FACTURA_XML) throw new ErrorNegocio('DATOS_INVALIDOS', 'Para quitar una factura, retira la factura');
    const t = await bloquearTransaccion(trx, a.transaccion_id);
    exigirEnCurso(t);
    if (a.etapa_id !== t.etapa_actual_id) throw new ErrorNegocio('SIN_PERMISO', 'Solo se pueden retirar documentos de la etapa en curso');
    await exigirResponsable(trx, actor, t, await obtenerEtapa(trx, t.etapa_actual_id));
    await trx.updateTable('adjuntos').set({ activo: false, inactivado_en: new Date(), inactivado_motivo: motivo }).where('id', '=', a.id).execute();
    await eventoSoporte(trx, t.id, t.etapa_actual_id, actor.id, 'adjunto_inactivado', { adjunto_id: a.id, tipo: a.tipo, motivo });
  });
}

/** Conversación libre; cualquier usuario, también en transacciones cerradas. */
export async function comentar(ctx: ContextoFlujo, actor: Actor, transaccionId: number, texto: string) {
  return ctx.db.transaction().execute(async (trx) => {
    const t = await trx.selectFrom('transacciones').select(['id', 'etapa_actual_id']).where('id', '=', transaccionId).executeTakeFirst();
    if (!t) throw new ErrorNegocio('NO_ENCONTRADA', 'La transacción no existe');
    const c = await trx.insertInto('comentarios').values({ transaccion_id: t.id, etapa_id: t.etapa_actual_id, autor_id: actor.id, texto: texto.trim() })
      .returningAll().executeTakeFirstOrThrow();
    await eventoSoporte(trx, t.id, t.etapa_actual_id, actor.id, 'comentario', { comentario_id: c.id });
    return c;
  });
}
