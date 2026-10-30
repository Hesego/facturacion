// Administración: usuarios, equipos, etapas del flujo y configuración.
// Solo el equipo «administrador». Las validaciones protegen que el flujo siga funcionando:
// no se puede desactivar a alguien con gastos asignados, desactivar una etapa con gastos en
// curso, ni romper la forma del flujo (la etapa del sistema siempre al final).
import { sql } from 'kysely';
import bcrypt from 'bcryptjs';
import type { z } from 'zod';
import { CONFIG_EDITABLE, type areaDatos, type equipoDatos, type etapaDatos, type usuarioCambios, type usuarioNuevo } from '@gastos/shared';
import type { BD, Trx } from '../db/conexion.js';
import type { Actor } from './autorizacion.js';
import { ErrorNegocio, violacionUnica } from './errores.js';

export function exigirAdministrador(actor: Actor) {
  if (!actor.equipos.includes('administrador')) {
    throw new ErrorNegocio('SIN_PERMISO', 'Solo el equipo administrador puede entrar a la administración');
  }
}

async function idsEquipos(trx: Trx, codigos: string[]) {
  if (!codigos.length) return [];
  const filas = await trx.selectFrom('equipos').select(['id', 'codigo']).where('codigo', 'in', codigos).execute();
  const faltan = codigos.filter((c) => !filas.some((f) => f.codigo === c));
  if (faltan.length) throw new ErrorNegocio('DATOS_INVALIDOS', `No existen los equipos: ${faltan.join(', ')}`);
  return filas.map((f) => f.id);
}

const duplicado = (e: unknown, mensaje: string) => {
  if (violacionUnica(e) !== null) throw new ErrorNegocio('DATOS_INVALIDOS', mensaje);
  throw e;
};

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export async function listarUsuarios(db: BD) {
  const [usuarios, equipos, asignadas, areas] = await Promise.all([
    db.selectFrom('usuarios').select(['id', 'email', 'nombre', 'cargo', 'activo', 'proveedor_auth', 'ultimo_acceso', 'creado_en']).orderBy('nombre').execute(),
    db.selectFrom('usuario_equipo as ue').innerJoin('equipos as e', 'e.id', 'ue.equipo_id').select(['ue.usuario_id', 'e.codigo']).execute(),
    db.selectFrom('transacciones').select(['asignado_a', (eb) => eb.fn.countAll<number>().as('n')]).where('estado', '=', 'en_curso').groupBy('asignado_a').execute(),
    db.selectFrom('usuario_area').select(['usuario_id', 'area_id']).execute(),
  ]);
  return usuarios.map((u) => ({
    ...u,
    equipos: equipos.filter((e) => e.usuario_id === u.id).map((e) => e.codigo),
    asignadas: Number(asignadas.find((a) => a.asignado_a === u.id)?.n ?? 0),
    areas: areas.filter((a) => a.usuario_id === u.id).map((a) => a.area_id),
  }));
}

async function asignar(trx: Trx, usuarioId: number, equipos?: string[], areas?: number[]) {
  if (equipos) {
    const ids = await idsEquipos(trx, equipos);
    await trx.deleteFrom('usuario_equipo').where('usuario_id', '=', usuarioId).execute();
    if (ids.length) await trx.insertInto('usuario_equipo').values(ids.map((equipo_id) => ({ usuario_id: usuarioId, equipo_id }))).execute();
  }
  // Las áreas deben ser de equipos a los que pertenece el usuario
  const susEquipos = (await trx.selectFrom('usuario_equipo').select('equipo_id').where('usuario_id', '=', usuarioId).execute()).map((e) => e.equipo_id);
  const actuales = areas ?? (await trx.selectFrom('usuario_area').select('area_id').where('usuario_id', '=', usuarioId).execute()).map((a) => a.area_id);
  const filas = actuales.length
    ? await trx.selectFrom('areas as a').innerJoin('equipos as q', 'q.id', 'a.equipo_id').select(['a.id', 'a.equipo_id', 'a.nombre', 'q.nombre as equipo'])
        .where('a.id', 'in', actuales).execute()
    : [];
  if (areas) {
    const faltan = areas.filter((id) => !filas.some((f) => f.id === id));
    if (faltan.length) throw new ErrorNegocio('DATOS_INVALIDOS', 'Alguna de las áreas no existe');
    const ajena = filas.find((f) => !susEquipos.includes(f.equipo_id));
    if (ajena) throw new ErrorNegocio('DATOS_INVALIDOS', `El área ${ajena.nombre} es de ${ajena.equipo}: agrega primero al usuario a ese equipo`);
  }
  // Al quitarle un equipo, salen también sus áreas de ese equipo
  const validas = filas.filter((f) => susEquipos.includes(f.equipo_id)).map((f) => f.id);
  await trx.deleteFrom('usuario_area').where('usuario_id', '=', usuarioId).execute();
  if (validas.length) await trx.insertInto('usuario_area').values([...new Set(validas)].map((area_id) => ({ usuario_id: usuarioId, area_id }))).execute();
}

export async function crearUsuario(db: BD, d: z.infer<typeof usuarioNuevo>) {
  return db.transaction().execute(async (trx) => {
    const u = await trx.insertInto('usuarios')
      .values({ email: d.email, nombre: d.nombre, cargo: d.cargo, password_hash: await bcrypt.hash(d.password, 10) })
      .returning(['id', 'email', 'nombre']).executeTakeFirstOrThrow()
      .catch((e) => duplicado(e, `Ya existe un usuario con el correo ${d.email}`));
    await asignar(trx, u.id, d.equipos, d.areas);
    return u;
  });
}

export async function actualizarUsuario(db: BD, actor: Actor, id: number, d: z.infer<typeof usuarioCambios>) {
  return db.transaction().execute(async (trx) => {
    const u = await trx.selectFrom('usuarios').select(['id', 'nombre']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!u) throw new ErrorNegocio('NO_ENCONTRADA', 'El usuario no existe');
    if (id === actor.id && d.activo === false) throw new ErrorNegocio('DATOS_INVALIDOS', 'No puedes desactivar tu propio usuario');
    if (id === actor.id && d.equipos && !d.equipos.includes('administrador')) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'No puedes quitarte del equipo administrador: pídeselo a otro administrador');
    }

    await trx.updateTable('usuarios').set({
      ...(d.nombre !== undefined && { nombre: d.nombre }),
      ...(d.cargo !== undefined && { cargo: d.cargo }),
      ...(d.activo !== undefined && { activo: d.activo }),
      ...(d.password && { password_hash: await bcrypt.hash(d.password, 10) }),
    }).where('id', '=', id).execute();
    await asignar(trx, id, d.equipos, d.areas);

    // Nadie queda con gastos asignados a un usuario que ya no puede atenderlos
    if (d.activo === false) {
      const n = await trx.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).where('asignado_a', '=', id).where('estado', '=', 'en_curso').executeTakeFirstOrThrow();
      if (Number(n.n) > 0) throw new ErrorNegocio('DATOS_INVALIDOS', `${u.nombre} tiene ${n.n} gasto(s) asignado(s). Reasígnalos antes de desactivarlo.`);
    }
    // Desactivar o cambiar la contraseña cierra sus sesiones abiertas
    if (d.activo === false || d.password) {
      await trx.updateTable('sesiones').set({ revocada_en: new Date() }).where('usuario_id', '=', id).where('revocada_en', 'is', null).execute();
    }
  });
}

// ---------------------------------------------------------------------------
// Equipos
// ---------------------------------------------------------------------------

export async function listarEquipos(db: BD) {
  return db.selectFrom('equipos as e')
    .leftJoin('usuarios as l', 'l.id', 'e.lider_usuario_id')
    .select(['e.id', 'e.codigo', 'e.nombre', 'e.descripcion', 'e.activo', 'e.lider_usuario_id', 'l.nombre as lider_nombre',
      (eb) => eb.selectFrom('usuario_equipo').select((x) => x.fn.countAll<number>().as('n')).whereRef('equipo_id', '=', 'e.id').as('miembros'),
      (eb) => eb.selectFrom('catalogo_etapas').select((x) => x.fn.agg<string[]>('array_agg', ['codigo']).as('c'))
        .whereRef('equipo_id', '=', 'e.id').where('activa', '=', true).as('etapas')])
    .orderBy('e.nombre').execute();
}

async function validarLiderEquipo(trx: Trx, id: number | null) {
  if (id === null) return;
  const u = await trx.selectFrom('usuarios').select('activo').where('id', '=', id).executeTakeFirst();
  if (!u?.activo) throw new ErrorNegocio('DATOS_INVALIDOS', 'El líder debe ser un usuario activo');
}

export async function guardarEquipo(db: BD, id: number | null, d: z.infer<typeof equipoDatos>) {
  return db.transaction().execute(async (trx) => {
    await validarLiderEquipo(trx, d.liderUsuarioId);
    const valores = { nombre: d.nombre, descripcion: d.descripcion, lider_usuario_id: d.liderUsuarioId, activo: d.activo };
    if (id === null) {
      return trx.insertInto('equipos').values({ codigo: d.codigo, ...valores }).returningAll().executeTakeFirstOrThrow()
        .catch((e) => duplicado(e, `Ya existe un equipo con el código ${d.codigo}`));
    }
    const actual = await trx.selectFrom('equipos').select('codigo').where('id', '=', id).executeTakeFirst();
    if (!actual) throw new ErrorNegocio('NO_ENCONTRADA', 'El equipo no existe');
    if (actual.codigo !== d.codigo) throw new ErrorNegocio('DATOS_INVALIDOS', 'El código de un equipo no se cambia: lo usan la configuración y los permisos');
    if (!d.activo) {
      const usada = await trx.selectFrom('catalogo_etapas').select('codigo').where('equipo_id', '=', id).where('activa', '=', true).executeTakeFirst();
      if (usada) throw new ErrorNegocio('DATOS_INVALIDOS', `El equipo es responsable de la etapa ${usada.codigo}: cámbiala antes de desactivarlo`);
      if (actual.codigo === 'administrador') throw new ErrorNegocio('DATOS_INVALIDOS', 'El equipo administrador no se desactiva');
    }
    return trx.updateTable('equipos').set(valores).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  });
}

// ---------------------------------------------------------------------------
// Áreas dentro de los equipos
// ---------------------------------------------------------------------------

export async function listarAreas(db: BD) {
  return db.selectFrom('areas as a')
    .innerJoin('equipos as q', 'q.id', 'a.equipo_id')
    .select(['a.id', 'a.equipo_id', 'q.nombre as equipo', 'a.codigo', 'a.nombre', 'a.activa',
      (eb) => eb.selectFrom('usuario_area').select((x) => x.fn.countAll<number>().as('n')).whereRef('area_id', '=', 'a.id').as('miembros'),
      (eb) => eb.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).whereRef('area_id', '=', 'a.id').where('estado', '=', 'en_curso').as('en_curso')])
    .orderBy('q.nombre').orderBy('a.nombre').execute();
}

export async function guardarArea(db: BD, id: number | null, d: z.infer<typeof areaDatos>) {
  return db.transaction().execute(async (trx) => {
    const equipo = await trx.selectFrom('equipos').select('id').where('id', '=', d.equipoId).executeTakeFirst();
    if (!equipo) throw new ErrorNegocio('DATOS_INVALIDOS', 'El equipo no existe');
    if (id === null) {
      return trx.insertInto('areas').values({ equipo_id: d.equipoId, codigo: d.codigo, nombre: d.nombre, activa: d.activa }).returningAll().executeTakeFirstOrThrow()
        .catch((e) => duplicado(e, `Ese equipo ya tiene un área con el código ${d.codigo}`));
    }
    const actual = await trx.selectFrom('areas').select(['equipo_id', 'activa']).where('id', '=', id).executeTakeFirst();
    if (!actual) throw new ErrorNegocio('NO_ENCONTRADA', 'El área no existe');
    if (actual.equipo_id !== d.equipoId) throw new ErrorNegocio('DATOS_INVALIDOS', 'Un área no se cambia de equipo: crea una nueva');
    if (actual.activa && !d.activa) {
      const n = await trx.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).where('area_id', '=', id).where('estado', '=', 'en_curso').executeTakeFirstOrThrow();
      if (Number(n.n) > 0) throw new ErrorNegocio('DATOS_INVALIDOS', `El área tiene ${n.n} gasto(s) en curso: espera a que avancen o reasígnalos`);
    }
    return trx.updateTable('areas').set({ codigo: d.codigo, nombre: d.nombre, activa: d.activa }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
      .catch((e) => duplicado(e, `Ese equipo ya tiene un área con el código ${d.codigo}`));
  });
}

// ---------------------------------------------------------------------------
// Etapas del flujo (catalogo_etapas)
// ---------------------------------------------------------------------------

export const listarEtapas = (db: BD) =>
  db.selectFrom('catalogo_etapas as e')
    .select(['e.id', 'e.codigo', 'e.nombre', 'e.descripcion', 'e.grupo', 'e.orden', 'e.tipo', 'e.equipo_id', 'e.sla_dias',
      'e.etapa_devolucion_id', 'e.segregacion', 'e.requisitos', 'e.activa',
      (eb) => eb.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).whereRef('etapa_actual_id', '=', 'e.id').where('estado', '=', 'en_curso').as('en_curso')])
    .orderBy('e.orden').execute();

/** El flujo activo debe empezar en una etapa humana, tener a quién enviar y terminar en una sola etapa del sistema. */
async function validarFormaDelFlujo(trx: Trx) {
  const activas = await trx.selectFrom('catalogo_etapas').select(['codigo', 'tipo']).where('activa', '=', true).orderBy('orden').execute();
  const sistema = activas.filter((e) => e.tipo === 'sistema');
  if (activas.length < 2) throw new ErrorNegocio('DATOS_INVALIDOS', 'El flujo necesita al menos una etapa y el cierre');
  if (sistema.length !== 1 || activas.at(-1)!.tipo !== 'sistema') {
    throw new ErrorNegocio('DATOS_INVALIDOS', 'El flujo debe terminar en una única etapa del sistema (cierre)');
  }
  if (activas[0]!.tipo === 'aprobacion') {
    throw new ErrorNegocio('DATOS_INVALIDOS', 'La primera etapa crea las solicitudes: no puede ser de aprobación');
  }
}

export async function guardarEtapa(db: BD, id: number | null, d: z.infer<typeof etapaDatos>) {
  if ((d.tipo === 'sistema') !== (d.equipoId === null)) {
    throw new ErrorNegocio('DATOS_INVALIDOS', d.tipo === 'sistema' ? 'La etapa del sistema no tiene equipo responsable' : 'Elige el equipo responsable de la etapa');
  }
  const valores = {
    codigo: d.codigo, nombre: d.nombre, descripcion: d.descripcion, grupo: d.grupo, orden: d.orden, tipo: d.tipo, equipo_id: d.equipoId,
    sla_dias: d.slaDias, etapa_devolucion_id: d.etapaDevolucionId, segregacion: d.segregacion,
    requisitos: JSON.stringify(d.requisitos), activa: d.activa,
  };
  return db.transaction().execute(async (trx) => {
    let fila;
    if (id === null) {
      fila = await trx.insertInto('catalogo_etapas').values(valores).returningAll().executeTakeFirstOrThrow()
        .catch((e) => duplicado(e, `Ya existe una etapa con ese código u orden (${d.codigo}, ${d.orden})`));
    } else {
      const actual = await trx.selectFrom('catalogo_etapas').select(['codigo', 'activa']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!actual) throw new ErrorNegocio('NO_ENCONTRADA', 'La etapa no existe');
      if (actual.codigo !== d.codigo) {
        const usada = await trx.selectFrom('eventos').select('id').where((eb) => eb.or([eb('etapa_origen_id', '=', id), eb('etapa_destino_id', '=', id)])).executeTakeFirst();
        if (usada) throw new ErrorNegocio('DATOS_INVALIDOS', 'El código de una etapa con historial no se cambia (está en la auditoría)');
      }
      if (actual.activa && !d.activa) {
        const n = await trx.selectFrom('transacciones').select((x) => x.fn.countAll<number>().as('n')).where('etapa_actual_id', '=', id).where('estado', '=', 'en_curso').executeTakeFirstOrThrow();
        if (Number(n.n) > 0) throw new ErrorNegocio('DATOS_INVALIDOS', `Hay ${n.n} gasto(s) en la etapa ${d.codigo}: espera a que avancen antes de desactivarla`);
      }
      fila = await trx.updateTable('catalogo_etapas').set(valores).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
        .catch((e) => duplicado(e, `Ya existe una etapa con ese código u orden (${d.codigo}, ${d.orden})`));
    }
    await validarFormaDelFlujo(trx);
    return fila;
  });
}

/** Reordena las etapas activas según la lista recibida (orden 10, 20, 30…). */
export async function reordenarEtapas(db: BD, ids: number[]) {
  return db.transaction().execute(async (trx) => {
    await sql`SET CONSTRAINTS catalogo_etapas_orden_uq DEFERRED`.execute(trx);
    const activas = await trx.selectFrom('catalogo_etapas').select('id').where('activa', '=', true).execute();
    if (activas.length !== ids.length || !activas.every((a) => ids.includes(a.id))) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'Envía todas las etapas activas, cada una una vez');
    }
    // Las inactivas se corren al final para no chocar con los nuevos números
    await trx.updateTable('catalogo_etapas').set((eb) => ({ orden: eb('orden', '+', 100_000) })).where('activa', '=', false).execute();
    for (const [i, id] of ids.entries()) await trx.updateTable('catalogo_etapas').set({ orden: (i + 1) * 10 }).where('id', '=', id).execute();
    await validarFormaDelFlujo(trx);
  });
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

export async function listarConfiguracion(db: BD) {
  const filas = await db.selectFrom('configuracion').select(['clave', 'valor', 'descripcion', 'actualizado_en']).orderBy('clave').execute();
  return filas.map((f) => ({ ...f, editable: f.clave in CONFIG_EDITABLE }));
}

export async function guardarConfiguracion(db: BD, clave: string, valor: unknown) {
  if (!(clave in CONFIG_EDITABLE)) throw new ErrorNegocio('DATOS_INVALIDOS', `La clave ${clave} no se edita desde la administración`);
  const v = CONFIG_EDITABLE[clave as keyof typeof CONFIG_EDITABLE].parse(valor);
  if (Array.isArray(v)) {
    const existentes = await db.selectFrom('equipos').select('codigo').where('codigo', 'in', v as string[]).execute();
    const faltan = (v as string[]).filter((c) => !existentes.some((e) => e.codigo === c));
    if (faltan.length) throw new ErrorNegocio('DATOS_INVALIDOS', `No existen los equipos: ${faltan.join(', ')}`);
  }
  await db.updateTable('configuracion').set({ valor: JSON.stringify(v) }).where('clave', '=', clave).execute();
}
