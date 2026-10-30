import { requisitosEtapa, type ItemRequisito, type RequisitosEtapa } from '@gastos/shared';
import type { BD, Trx } from '../db/conexion.js';
import type { Etapa, Transaccion } from '../db/esquema.js';
import { ErrorNegocio } from './errores.js';

export function leerRequisitos(etapa: Etapa): RequisitosEtapa {
  const r = requisitosEtapa.safeParse(etapa.requisitos ?? {});
  if (!r.success) {
    throw new ErrorNegocio('CONFIGURACION_INVALIDA', `Los requisitos de la etapa ${etapa.codigo} están mal configurados`, r.error.issues);
  }
  return r.data;
}

/**
 * Lista de verificación de una etapa: qué exige y si ya se cumple. La usa `avanzar` para
 * bloquear y el detalle de la transacción para mostrar qué falta.
 */
export async function evaluarRequisitos(db: BD | Trx, t: Transaccion, etapa: Etapa, comentario?: string): Promise<ItemRequisito[]> {
  const req = leerRequisitos(etapa);
  const items: ItemRequisito[] = [];

  const tipos = [...req.referencias.map((r) => r.tipo), ...req.referencias_previas];
  if (tipos.length) {
    const activas = await db.selectFrom('referencias').select(['tipo', 'numero'])
      .where('transaccion_id', '=', t.id).where('activa', '=', true).execute();
    const porTipo = new Map(activas.map((r) => [r.tipo, r.numero]));
    for (const r of req.referencias) {
      items.push({ clave: `referencia:${r.tipo}`, descripcion: r.etiqueta, cumple: porTipo.has(r.tipo), detalle: porTipo.get(r.tipo) });
    }
    for (const tipo of req.referencias_previas) {
      items.push({ clave: `referencia_previa:${tipo}`, descripcion: `Número de ${tipo} registrado`, cumple: porTipo.has(tipo), detalle: porTipo.get(tipo) });
    }
  }

  if (req.adjuntos.length) {
    const conteos = await db.selectFrom('adjuntos')
      .select(['tipo', (eb) => eb.fn.countAll<number>().as('n')])
      .where('transaccion_id', '=', t.id).where('etapa_id', '=', etapa.id).where('activo', '=', true)
      .groupBy('tipo').execute();
    const porTipo = new Map(conteos.map((c) => [c.tipo, Number(c.n)]));
    for (const a of req.adjuntos) {
      const n = porTipo.get(a.tipo) ?? 0;
      items.push({ clave: `adjunto:${a.tipo}`, descripcion: a.etiqueta, cumple: n >= a.min, detalle: a.min > 1 ? `${n} de ${a.min}` : undefined });
    }
  }

  if (req.facturas && req.facturas.min > 0) {
    const r = await db.selectFrom('facturas').select((eb) => eb.fn.countAll<number>().as('n'))
      .where('transaccion_id', '=', t.id).where('activa', '=', true).executeTakeFirstOrThrow();
    const n = Number(r.n);
    items.push({ clave: 'facturas:min', descripcion: req.facturas.min === 1 ? 'Al menos una factura' : `Al menos ${req.facturas.min} facturas`,
      cumple: n >= req.facturas.min, detalle: `${n} registrada(s)` });
  }

  if (req.comentario_obligatorio) {
    items.push({ clave: 'comentario', descripcion: etapa.tipo === 'aprobacion' ? 'Comentario de la aprobación' : 'Comentario',
      cumple: (comentario ?? '').trim().length >= 3 });
  }
  return items;
}
