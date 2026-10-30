import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as esq from '@gastos/shared';
import { actor, type Dependencias } from '../app.js';
import { catalogos, detalleTransaccion, listarTransacciones, pendientes } from '../dominio/consultas.js';
import { ErrorNegocio } from '../dominio/errores.js';
import { anular, avanzar, crearSolicitud, devolver, reasignar } from '../dominio/flujo.js';
import { comentar, inactivarAdjunto, inactivarFactura, registrarAdjuntos, registrarFacturas, type ArchivoEntrante } from '../dominio/soportes.js';
import type { FacturaEntrante } from '../dominio/facturas.js';

const conId = z.object({ id: esq.idNumerico });

interface Formulario {
  campos: Record<string, string>;
  /** Archivos con el nombre del campo del formulario en que llegaron. */
  archivos: { campo: string; archivo: ArchivoEntrante }[];
}

/** Lee un formulario multipart: campos y archivos (hasta 20). */
async function leerFormulario(req: FastifyRequest): Promise<Formulario> {
  if (!req.isMultipart()) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Envía los archivos como formulario multipart');
  const campos: Record<string, string> = {};
  const archivos: Formulario['archivos'] = [];
  for await (const parte of req.parts()) {
    if (parte.type === 'file') archivos.push({ campo: parte.fieldname, archivo: { nombre: parte.filename, mime: parte.mimetype, contenido: await parte.toBuffer() } });
    else campos[parte.fieldname] = String(parte.value);
  }
  return { campos, archivos };
}

const deCampo = (f: Formulario, ...nombres: string[]) => f.archivos.filter((a) => nombres.includes(a.campo)).map((a) => a.archivo);

/**
 * Agrupa las facturas: archivos `factura_<i>` con su número en `numero_<i>`. Por compatibilidad,
 * los archivos del campo `archivos` forman una sola factura con el número de `numero`.
 */
function facturasDe(f: Formulario): FacturaEntrante[] {
  const grupos = new Map<string, ArchivoEntrante[]>();
  for (const { campo, archivo } of f.archivos) {
    const m = campo.match(/^factura_(\d{1,2})$/) ?? (campo === 'archivos' ? [campo, ''] : null);
    if (m) grupos.set(m[1]!, [...(grupos.get(m[1]!) ?? []), archivo]);
  }
  return [...grupos.entries()].sort(([a], [b]) => Number(a) - Number(b))
    .map(([i, archivos]) => ({ numero: (i === '' ? f.campos.numero : f.campos[`numero_${i}`])?.trim() || undefined, archivos }));
}

export const rutasTransacciones = (dep: Dependencias): FastifyPluginAsync => async (app) => {
  const ctx = { db: dep.db, appUrl: dep.config.APP_URL, almacenamiento: dep.almacenamiento };

  app.get('/catalogos', async (req) => {
    actor(req);
    return catalogos(dep.db);
  });

  app.get('/pendientes', async (req) => pendientes(dep.db, actor(req)));

  app.get('/transacciones', async (req) => {
    actor(req);
    return listarTransacciones(dep.db, esq.filtroTransacciones.parse(req.query));
  });

  /** Nueva solicitud: facturas (PDF y opcional XML/ZIP, con su número), soportes y a quién se envía. Se crea y se envía en un paso. */
  app.post('/transacciones', async (req, reply) => {
    const quien = actor(req);
    const f = await leerFormulario(req);
    const t = await crearSolicitud(ctx, quien, esq.crearSolicitud.parse(f.campos), facturasDe(f), deCampo(f, 'soporte'));
    return reply.status(201).send(t);
  });

  app.get('/transacciones/:id', async (req) => {
    const { id } = conId.parse(req.params);
    return detalleTransaccion(dep.db, actor(req), id);
  });

  /** Completar la etapa y enviarla: JSON, o multipart con los documentos de la etapa (`documento`) y soportes (`soporte`). */
  app.post('/transacciones/:id/avanzar', async (req) => {
    const { id } = conId.parse(req.params);
    const quien = actor(req);
    if (req.isMultipart()) {
      const f = await leerFormulario(req);
      return avanzar(ctx, quien, id, esq.avanzar.parse(f.campos), deCampo(f, 'documento', 'archivos'), deCampo(f, 'soporte'));
    }
    return avanzar(ctx, quien, id, esq.avanzar.parse(req.body));
  });

  app.post('/transacciones/:id/devolver', async (req) => {
    const { id } = conId.parse(req.params);
    return devolver(ctx, actor(req), id, esq.devolver.parse(req.body));
  });

  app.post('/transacciones/:id/reasignar', async (req) => {
    const { id } = conId.parse(req.params);
    return reasignar(ctx, actor(req), id, esq.reasignar.parse(req.body));
  });

  app.post('/transacciones/:id/anular', async (req) => {
    const { id } = conId.parse(req.params);
    return anular(ctx, actor(req), id, esq.anular.parse(req.body));
  });

  // --- Soportes adicionales ---
  app.post('/transacciones/:id/facturas', async (req, reply) => {
    const { id } = conId.parse(req.params);
    const quien = actor(req);
    const facturas = await registrarFacturas(ctx, quien, id, facturasDe(await leerFormulario(req)));
    return reply.status(201).send(facturas);
  });

  app.post('/transacciones/:id/adjuntos', async (req, reply) => {
    const { id } = conId.parse(req.params);
    const quien = actor(req);
    const f = await leerFormulario(req);
    return reply.status(201).send(await registrarAdjuntos(ctx, quien, id, f.archivos.map((a) => a.archivo)));
  });

  app.post('/transacciones/:id/comentarios', async (req, reply) => {
    const { id } = conId.parse(req.params);
    const c = await comentar(ctx, actor(req), id, esq.comentar.parse(req.body).texto);
    return reply.status(201).send(c);
  });

  app.post('/adjuntos/:id/inactivar', async (req) => {
    const { id } = conId.parse(req.params);
    await inactivarAdjunto(ctx, actor(req), id, esq.inactivar.parse(req.body).motivo);
    return { ok: true };
  });

  app.post('/facturas/:id/inactivar', async (req) => {
    const { id } = conId.parse(req.params);
    await inactivarFactura(ctx, actor(req), id, esq.inactivar.parse(req.body).motivo);
    return { ok: true };
  });

  /**
   * Ver el adjunto en el navegador, sin descargarlo. PDF e imágenes se muestran tal cual; el XML
   * se entrega como texto plano (nunca se interpreta). El ZIP no se puede ver: se descarga.
   */
  app.get('/adjuntos/:id/ver', async (req, reply) => {
    actor(req);
    const { id } = conId.parse(req.params);
    const a = await dep.db.selectFrom('adjuntos').select(['object_key', 'mime', 'nombre_original', 'tamano_bytes']).where('id', '=', id).executeTakeFirst();
    if (!a) throw new ErrorNegocio('NO_ENCONTRADA', 'El adjunto no existe');
    const tipo = a.mime === 'application/pdf' || a.mime === 'image/png' || a.mime === 'image/jpeg' ? a.mime
      : a.mime === 'application/xml' || a.mime === 'text/xml' ? 'text/plain; charset=utf-8' : null;
    if (!tipo) throw new ErrorNegocio('ARCHIVO_INVALIDO', 'Este tipo de archivo no se puede ver en pantalla: descárgalo');
    const ascii = a.nombre_original.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return reply
      .header('Content-Type', tipo)
      .header('Content-Length', String(a.tamano_bytes))
      .header('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nombre_original)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=300')
      .send(await dep.almacenamiento.obtener(a.object_key));
  });

  app.get('/adjuntos/:id/descarga', async (req, reply) => {
    actor(req);
    const { id } = conId.parse(req.params);
    const a = await dep.db.selectFrom('adjuntos').select(['object_key', 'mime', 'nombre_original', 'tamano_bytes']).where('id', '=', id).executeTakeFirst();
    if (!a) throw new ErrorNegocio('NO_ENCONTRADA', 'El adjunto no existe');
    const ascii = a.nombre_original.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return reply
      .header('Content-Type', a.mime)
      .header('Content-Length', String(a.tamano_bytes))
      .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nombre_original)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(await dep.almacenamiento.obtener(a.object_key));
  });
};
