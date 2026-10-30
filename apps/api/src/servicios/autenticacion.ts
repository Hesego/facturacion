import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { BD } from '../db/conexion.js';
import type { Actor } from '../dominio/autorizacion.js';
import { ErrorNegocio } from '../dominio/errores.js';

export const COOKIE_SESION = 'gastos_sesion';

// Hash de relleno: si el correo no existe se compara igual, para no revelar por el tiempo de respuesta qué correos existen
const HASH_RELLENO = bcrypt.hashSync('relleno-no-es-una-clave', 10);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function iniciarSesion(
  db: BD, email: string, password: string, opciones: { horas: number; ip?: string; userAgent?: string },
): Promise<{ token: string; expira: Date }> {
  const u = await db
    .selectFrom('usuarios')
    .select(['id', 'password_hash', 'activo', 'proveedor_auth'])
    .where('email', '=', email)
    .executeTakeFirst();
  const valida = await bcrypt.compare(password, u?.password_hash ?? HASH_RELLENO);
  if (!u || !valida || !u.activo || u.proveedor_auth !== 'local') {
    throw new ErrorNegocio('NO_AUTENTICADO', 'Correo o contraseña incorrectos');
  }

  const token = randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + opciones.horas * 3_600_000);
  await db.insertInto('sesiones').values({
    token_hash: hashToken(token), usuario_id: u.id, expira_en: expira,
    ip: opciones.ip ?? null, user_agent: opciones.userAgent?.slice(0, 300) ?? null,
  }).execute();
  await db.updateTable('usuarios').set({ ultimo_acceso: new Date() }).where('id', '=', u.id).execute();
  return { token, expira };
}

/** Resuelve la sesión de la cookie. Un usuario desactivado pierde el acceso de inmediato. */
export async function actorDeSesion(db: BD, token: string): Promise<Actor | null> {
  const u = await db
    .selectFrom('sesiones as s')
    .innerJoin('usuarios as u', 'u.id', 's.usuario_id')
    .select(['u.id', 'u.nombre', 'u.email'])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.revocada_en', 'is', null)
    .where('s.expira_en', '>', new Date())
    .where('u.activo', '=', true)
    .executeTakeFirst();
  return u ? cargarActor(db, u.id) : null;
}

export async function cargarActor(db: BD, usuarioId: number): Promise<Actor | null> {
  const u = await db.selectFrom('usuarios').select(['id', 'nombre', 'email']).where('id', '=', usuarioId).where('activo', '=', true).executeTakeFirst();
  if (!u) return null;
  const equipos = await db.selectFrom('usuario_equipo as ue').innerJoin('equipos as e', 'e.id', 'ue.equipo_id')
    .select('e.codigo').where('ue.usuario_id', '=', u.id).where('e.activo', '=', true).execute();
  return { ...u, equipos: equipos.map((e) => e.codigo) };
}

export async function cerrarSesion(db: BD, token: string) {
  await db.updateTable('sesiones').set({ revocada_en: new Date() }).where('token_hash', '=', hashToken(token)).execute();
}
