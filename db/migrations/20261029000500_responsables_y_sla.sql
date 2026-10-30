-- migrate:up

-- ---------------------------------------------------------------------------
-- ¿Quién puede actuar en una etapa de una transacción?
--   ninguna      → cualquier miembro activo del equipo responsable
--   miembro_area → miembros del equipo que además pertenecen al área de la transacción
--   lider_area   → solo el líder aprobador del área (y debe ser miembro del equipo)
-- La API usa esta misma función para autorizar: hay una sola definición de la regla.
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_responsables_etapa(p_transaccion_id bigint, p_etapa_id bigint)
RETURNS TABLE (usuario_id bigint, email citext, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.email, u.nombre
  FROM transacciones t
  JOIN areas a            ON a.id = t.area_id
  JOIN catalogo_etapas ce ON ce.id = p_etapa_id
  JOIN usuario_equipo ue  ON ue.equipo_id = ce.equipo_id
  JOIN usuarios u         ON u.id = ue.usuario_id AND u.activo
  WHERE t.id = p_transaccion_id
    AND (   ce.restriccion_area = 'ninguna'
         OR (ce.restriccion_area = 'miembro_area'
             AND EXISTS (SELECT 1 FROM usuario_area ua
                         WHERE ua.usuario_id = u.id AND ua.area_id = t.area_id))
         OR (ce.restriccion_area = 'lider_area' AND a.lider_aprobador_id = u.id));
$$;

-- A quién se escala una etapa vencida (decisión 2c)
CREATE FUNCTION fn_escalamiento_etapa(p_transaccion_id bigint, p_etapa_id bigint)
RETURNS TABLE (usuario_id bigint, email citext, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.email, u.nombre
  FROM transacciones t
  JOIN areas a            ON a.id = t.area_id
  JOIN catalogo_etapas ce ON ce.id = p_etapa_id
  LEFT JOIN equipos eq    ON eq.id = ce.equipo_id
  JOIN usuarios u ON u.activo AND u.id = coalesce(
         CASE WHEN ce.restriccion_area = 'miembro_area' THEN a.lider_aprobador_id END,
         eq.lider_usuario_id)
  WHERE t.id = p_transaccion_id;
$$;

-- Semáforo: verde el mismo día, amarillo y naranja según `configuracion.semaforo`,
-- rojo desde `sla_dias` de la etapa (vencida)
CREATE FUNCTION fn_semaforo(p_dias integer, p_sla_dias integer) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN p_dias >= p_sla_dias                                       THEN 'rojo'
           WHEN p_dias >= coalesce((s.valor ->> 'naranja')::int, 2)        THEN 'naranja'
           WHEN p_dias >= coalesce((s.valor ->> 'amarillo')::int, 1)       THEN 'amarillo'
           ELSE 'verde'
         END
  FROM (SELECT (SELECT valor FROM configuracion WHERE clave = 'semaforo') AS valor) s;
$$;

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------

-- Transacciones en curso con su antigüedad en la etapa y el semáforo
CREATE VIEW v_transacciones_en_curso AS
SELECT t.id,
       t.consecutivo,
       t.area_id,
       a.codigo        AS area_codigo,
       a.nombre        AS area_nombre,
       t.proveedor_id,
       p.nit           AS proveedor_nit,
       p.razon_social  AS proveedor_nombre,
       t.valor,
       t.descripcion,
       t.solicitante_id,
       t.etapa_actual_id,
       ce.codigo       AS etapa_codigo,
       ce.nombre       AS etapa_nombre,
       ce.grupo        AS etapa_grupo,
       ce.equipo_id,
       eq.codigo       AS equipo_codigo,
       ce.restriccion_area,
       ce.sla_dias,
       t.en_etapa_desde,
       d.dias          AS dias_habiles_en_etapa,
       fn_semaforo(d.dias, ce.sla_dias) AS semaforo,
       d.dias >= ce.sla_dias            AS vencida,
       t.version,
       t.creado_en
FROM transacciones t
JOIN areas a            ON a.id = t.area_id
JOIN proveedores p      ON p.id = t.proveedor_id
JOIN catalogo_etapas ce ON ce.id = t.etapa_actual_id
LEFT JOIN equipos eq    ON eq.id = ce.equipo_id
CROSS JOIN LATERAL (SELECT fn_dias_habiles(t.en_etapa_desde, now()) AS dias) d
WHERE t.estado = 'en_curso';

-- Insumo del recordatorio diario de n8n: destinatarios ya resueltos por la base de datos,
-- n8n solo arma y envía los correos.
CREATE VIEW v_sla_vencidas AS
SELECT v.id AS transaccion_id,
       v.consecutivo,
       v.area_nombre,
       v.proveedor_nombre,
       v.valor,
       v.etapa_codigo,
       v.etapa_nombre,
       v.sla_dias,
       v.dias_habiles_en_etapa,
       v.dias_habiles_en_etapa - v.sla_dias AS dias_vencida,
       v.en_etapa_desde,
       coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.usuario_id, 'email', r.email, 'nombre', r.nombre)
                                  ORDER BY r.nombre)
                 FROM fn_responsables_etapa(v.id, v.etapa_actual_id) r), '[]') AS responsables,
       (SELECT jsonb_build_object('id', x.usuario_id, 'email', x.email, 'nombre', x.nombre)
        FROM fn_escalamiento_etapa(v.id, v.etapa_actual_id) x LIMIT 1)        AS escalar_a,
       v.dias_habiles_en_etapa - v.sla_dias
         >= coalesce((SELECT (valor #>> '{}')::int FROM configuracion
                      WHERE clave = 'escalamiento_dias_despues_de_vencer'), 0) AS escalar
FROM v_transacciones_en_curso v
WHERE v.vencida;

-- migrate:down

DROP VIEW v_sla_vencidas;
DROP VIEW v_transacciones_en_curso;
DROP FUNCTION fn_semaforo(integer, integer);
DROP FUNCTION fn_escalamiento_etapa(bigint, bigint);
DROP FUNCTION fn_responsables_etapa(bigint, bigint);
