import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'kysely';
import { ZodError } from 'zod';
import type { RespuestaError } from '@gastos/shared';
import type { Config } from './config.js';
import type { BD } from './db/conexion.js';
import type { Actor } from './dominio/autorizacion.js';
import { ErrorNegocio } from './dominio/errores.js';
import type { Almacenamiento } from './servicios/almacenamiento.js';
import { actorDeSesion, COOKIE_SESION } from './servicios/autenticacion.js';
import { rutasAutenticacion } from './rutas/autenticacion.js';
import { rutasTransacciones } from './rutas/transacciones.js';
import { rutasAdministracion, rutasTablero } from './rutas/administracion.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export interface Dependencias {
  config: Pick<Config, 'APP_URL' | 'SESION_HORAS' | 'COOKIE_SECURE' | 'NODE_ENV'>;
  db: BD;
  almacenamiento: Almacenamiento;
}

/** Exige sesión válida; devuelve el actor. */
export function actor(req: FastifyRequest): Actor {
  if (!req.actor) throw new ErrorNegocio('NO_AUTENTICADO', 'Tu sesión expiró. Vuelve a iniciar sesión.');
  return req.actor;
}

export async function construirApp(dep: Dependencias) {
  const app = Fastify({
    logger: dep.config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie'] },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // Hasta 20 archivos por formulario (varias facturas con su XML o ZIP, y soportes)
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 20, fields: 50 } });

  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[COOKIE_SESION];
    if (token) req.actor = await actorDeSesion(dep.db, token);
  });

  app.setErrorHandler((error, req, reply) => {
    let status = 500;
    let cuerpo: RespuestaError = { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo o avisa al administrador.' };

    if (error instanceof ErrorNegocio) {
      status = error.status;
      cuerpo = { codigo: error.codigo, mensaje: error.message, detalles: error.detalles };
    } else if (error instanceof ZodError) {
      status = 422;
      cuerpo = { codigo: 'DATOS_INVALIDOS', mensaje: error.issues.map((i) => i.message).join('. '),
        detalles: error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) };
    } else if ((error as { statusCode?: number }).statusCode === 429) {
      status = 429;
      cuerpo = { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' };
    } else if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      status = 422;
      cuerpo = { codigo: 'ARCHIVO_INVALIDO', mensaje: 'El archivo es demasiado grande' };
    } else if ((error as { code?: string }).code === '23514') {
      // CHECK de la base de datos: la última línea de defensa
      status = 422;
      cuerpo = { codigo: 'DATOS_INVALIDOS', mensaje: error.message };
    }
    if (status >= 500) req.log.error(error);
    return reply.status(status).send(cuerpo);
  });

  app.get('/api/salud', async () => {
    await sql`SELECT 1`.execute(dep.db);
    return { estado: 'ok' };
  });

  await app.register(rutasAutenticacion(dep), { prefix: '/api/auth' });
  await app.register(rutasTransacciones(dep), { prefix: '/api' });
  await app.register(rutasTablero(dep), { prefix: '/api' });
  await app.register(rutasAdministracion(dep), { prefix: '/api/admin' });
  return app;
}
