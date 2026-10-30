import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as esq from '@gastos/shared';
import { actor, type Dependencias } from '../app.js';
import * as adm from '../dominio/administracion.js';
import { tablero } from '../dominio/tablero.js';

const conId = z.object({ id: esq.idNumerico });

/** Tablero: lo ve cualquier usuario con sesión (transparencia del proceso). */
export const rutasTablero = (dep: Dependencias): FastifyPluginAsync => async (app) => {
  app.get('/tablero', async (req) => {
    actor(req);
    return tablero(dep.db);
  });
};

/** Administración: solo el equipo administrador. */
export const rutasAdministracion = (dep: Dependencias): FastifyPluginAsync => async (app) => {
  app.addHook('preHandler', async (req) => adm.exigirAdministrador(actor(req)));
  const db = dep.db;

  app.get('/usuarios', () => adm.listarUsuarios(db));
  app.post('/usuarios', async (req, reply) => reply.status(201).send(await adm.crearUsuario(db, esq.usuarioNuevo.parse(req.body))));
  app.patch('/usuarios/:id', async (req) => {
    await adm.actualizarUsuario(db, actor(req), conId.parse(req.params).id, esq.usuarioCambios.parse(req.body));
    return { ok: true };
  });

  app.get('/equipos', () => adm.listarEquipos(db));
  app.post('/equipos', async (req, reply) => reply.status(201).send(await adm.guardarEquipo(db, null, esq.equipoDatos.parse(req.body))));
  app.put('/equipos/:id', async (req) => adm.guardarEquipo(db, conId.parse(req.params).id, esq.equipoDatos.parse(req.body)));

  app.get('/areas', () => adm.listarAreas(db));
  app.post('/areas', async (req, reply) => reply.status(201).send(await adm.guardarArea(db, null, esq.areaDatos.parse(req.body))));
  app.put('/areas/:id', async (req) => adm.guardarArea(db, conId.parse(req.params).id, esq.areaDatos.parse(req.body)));

  app.get('/etapas', () => adm.listarEtapas(db));
  app.post('/etapas', async (req, reply) => reply.status(201).send(await adm.guardarEtapa(db, null, esq.etapaDatos.parse(req.body))));
  app.put('/etapas/:id', async (req) => adm.guardarEtapa(db, conId.parse(req.params).id, esq.etapaDatos.parse(req.body)));
  app.post('/etapas/orden', async (req) => {
    await adm.reordenarEtapas(db, esq.ordenEtapas.parse(req.body).ids);
    return { ok: true };
  });

  app.get('/configuracion', () => adm.listarConfiguracion(db));
  app.put('/configuracion/:clave', async (req) => {
    const { clave } = z.object({ clave: z.string() }).parse(req.params);
    await adm.guardarConfiguracion(db, clave, (req.body as { valor?: unknown })?.valor);
    return { ok: true };
  });
};
