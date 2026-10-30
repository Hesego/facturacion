import type { FastifyPluginAsync } from 'fastify';
import { credenciales } from '@gastos/shared';
import { actor, type Dependencias } from '../app.js';
import { cerrarSesion, COOKIE_SESION, iniciarSesion } from '../servicios/autenticacion.js';

export const rutasAutenticacion = (dep: Dependencias): FastifyPluginAsync => async (app) => {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = credenciales.parse(req.body);
    const { token, expira } = await iniciarSesion(dep.db, email, password, {
      horas: dep.config.SESION_HORAS, ip: req.ip, userAgent: req.headers['user-agent'],
    });
    reply.setCookie(COOKIE_SESION, token, {
      path: '/', httpOnly: true, sameSite: 'strict', secure: dep.config.COOKIE_SECURE, expires: expira,
    });
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_SESION];
    if (token) await cerrarSesion(dep.db, token);
    reply.clearCookie(COOKIE_SESION, { path: '/' });
    return { ok: true };
  });

  app.get('/yo', async (req) => actor(req));
};
