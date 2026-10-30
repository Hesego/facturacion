import { sql } from 'kysely';
import type { BD } from '../db/conexion.js';

/** Inicio del mes en curso, hora de Colombia. */
const INICIO_MES = sql`(date_trunc('month', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')`;
/** Ventana para promedios de tiempo: últimos 180 días. */
const VENTANA = sql`now() - interval '180 days'`;

/**
 * Tablero general. Los tiempos por etapa salen del historial (eventos): cada tramo va desde
 * que la transacción entra a una etapa hasta el siguiente evento de transición.
 */
export async function tablero(db: BD) {
  const [totales, porEtapa, tiempos, atascadas, ciclo, porArea] = await Promise.all([
    sql<{ en_curso: number; valor_en_curso: string; vencidas: number; pagadas_mes: number; valor_pagado_mes: string; anuladas_mes: number }>`
      SELECT count(*) FILTER (WHERE t.estado = 'en_curso')::int                                      AS en_curso,
             coalesce(sum(t.valor) FILTER (WHERE t.estado = 'en_curso'), 0)::text                    AS valor_en_curso,
             (SELECT count(*) FROM v_transacciones_en_curso WHERE vencida)::int                     AS vencidas,
             count(*) FILTER (WHERE t.estado = 'pagada' AND t.cerrado_en >= ${INICIO_MES})::int      AS pagadas_mes,
             coalesce(sum(t.valor) FILTER (WHERE t.estado = 'pagada' AND t.cerrado_en >= ${INICIO_MES}), 0)::text AS valor_pagado_mes,
             count(*) FILTER (WHERE t.estado = 'anulada' AND t.cerrado_en >= ${INICIO_MES})::int     AS anuladas_mes
      FROM transacciones t`.execute(db),

    sql<{ id: number; codigo: string; nombre: string; grupo: string; sla_dias: number; verde: number; amarillo: number; naranja: number; rojo: number; valor: string }>`
      SELECT ce.id, ce.codigo, ce.nombre, ce.grupo, ce.sla_dias,
             count(v.id) FILTER (WHERE v.semaforo = 'verde')::int    AS verde,
             count(v.id) FILTER (WHERE v.semaforo = 'amarillo')::int AS amarillo,
             count(v.id) FILTER (WHERE v.semaforo = 'naranja')::int  AS naranja,
             count(v.id) FILTER (WHERE v.semaforo = 'rojo')::int     AS rojo,
             coalesce(sum(v.valor), 0)::text                         AS valor
      FROM catalogo_etapas ce
      LEFT JOIN v_transacciones_en_curso v ON v.etapa_actual_id = ce.id
      WHERE ce.activa AND ce.tipo <> 'sistema'
      GROUP BY ce.id
      ORDER BY ce.orden`.execute(db),

    sql<{ codigo: string; tramos: number; dias_habiles: number; horas: number }>`
      WITH tramos AS (
        SELECT e.etapa_destino_id AS etapa_id, e.ocurrido_en AS entrada,
               lead(e.ocurrido_en) OVER (PARTITION BY e.transaccion_id ORDER BY e.id) AS salida
        FROM eventos e
        WHERE e.tipo IN ('creada', 'avanzada', 'devuelta', 'anulada', 'cerrada')
      )
      SELECT ce.codigo,
             count(*)::int                                                                AS tramos,
             round(avg(fn_dias_habiles(t.entrada, t.salida)), 1)::float8                   AS dias_habiles,
             round(avg(extract(epoch FROM t.salida - t.entrada) / 3600)::numeric, 1)::float8 AS horas
      FROM tramos t
      JOIN catalogo_etapas ce ON ce.id = t.etapa_id
      WHERE t.salida IS NOT NULL AND ce.tipo <> 'sistema' AND t.entrada >= ${VENTANA}
      GROUP BY ce.codigo`.execute(db),

    db.selectFrom('v_transacciones_en_curso')
      .select(['id', 'consecutivo', 'descripcion', 'facturas', 'asignado_nombre', 'area_nombre', 'valor', 'etapa_codigo', 'etapa_nombre',
        'equipo_codigo', 'sla_dias', 'dias_habiles_en_etapa', 'semaforo', 'en_etapa_desde'])
      .where('vencida', '=', true)
      .orderBy('dias_habiles_en_etapa', 'desc')
      .limit(10)
      .execute(),

    sql<{ pagadas: number; dias_habiles: number | null }>`
      SELECT count(*)::int AS pagadas, round(avg(fn_dias_habiles(creado_en, cerrado_en)), 1)::float8 AS dias_habiles
      FROM transacciones WHERE estado = 'pagada' AND cerrado_en >= ${VENTANA}`.execute(db),

    // Gastos en curso por área (las etapas de equipos sin áreas quedan como «Sin área»)
    sql<{ area_id: number | null; area: string; equipo: string | null; en_curso: number; vencidas: number }>`
      SELECT v.area_id, coalesce(v.area_nombre, 'Sin área') AS area, q.nombre AS equipo,
             count(*)::int AS en_curso, count(*) FILTER (WHERE v.vencida)::int AS vencidas
      FROM v_transacciones_en_curso v
      LEFT JOIN areas a ON a.id = v.area_id
      LEFT JOIN equipos q ON q.id = a.equipo_id
      GROUP BY v.area_id, v.area_nombre, q.nombre
      ORDER BY count(*) DESC`.execute(db),
  ]);

  const porCodigo = new Map(tiempos.rows.map((r) => [r.codigo, r]));
  return {
    totales: { ...totales.rows[0]!, ciclo_dias_habiles: ciclo.rows[0]?.dias_habiles ?? null, pagadas_180: ciclo.rows[0]?.pagadas ?? 0 },
    etapas: porEtapa.rows.map((e) => {
      const t = porCodigo.get(e.codigo);
      return { ...e, en_curso: e.verde + e.amarillo + e.naranja + e.rojo, tramos: t?.tramos ?? 0,
        promedio_dias_habiles: t?.dias_habiles ?? null, promedio_horas: t?.horas ?? null };
    }),
    atascadas,
    areas: porArea.rows,
  };
}
