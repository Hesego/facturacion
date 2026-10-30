-- migrate:up

-- Áreas dentro de cada equipo (2026-10-30). P. ej. Operaciones → SST, TICS, Inventario.
-- Al enviar a una etapa cuyo equipo tiene áreas, se elige el área y luego la persona de esa
-- área. El área a la que va la transacción queda registrada para filtrar y contar.
CREATE TABLE areas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id      bigint NOT NULL REFERENCES equipos (id),
  codigo         text NOT NULL CHECK (codigo ~ '^[A-Z][A-Z0-9_]*$'),
  nombre         text NOT NULL CHECK (btrim(nombre) <> ''),
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT areas_equipo_codigo_uq UNIQUE (equipo_id, codigo)
);
CREATE TRIGGER areas_actualizado_en BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

CREATE TABLE usuario_area (
  usuario_id  bigint NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  area_id     bigint NOT NULL REFERENCES areas (id) ON DELETE CASCADE,
  asignado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, area_id)
);
CREATE INDEX usuario_area_area_idx ON usuario_area (area_id);

-- Área a la que está asignada la transacción en su etapa actual (NULL si el equipo no tiene áreas)
ALTER TABLE transacciones ADD COLUMN area_id bigint REFERENCES areas (id);
CREATE INDEX transacciones_area_idx ON transacciones (area_id) WHERE estado = 'en_curso';

-- Las vistas se recrean con el área
DROP VIEW v_sla_vencidas;
DROP VIEW v_transacciones_en_curso;

CREATE VIEW v_transacciones_en_curso AS
SELECT t.id,
       t.consecutivo,
       t.valor,
       t.descripcion,
       (SELECT string_agg(f.numero, ', ' ORDER BY f.id) FROM facturas f WHERE f.transaccion_id = t.id AND f.activa) AS facturas,
       t.solicitante_id,
       t.asignado_a,
       u.nombre        AS asignado_nombre,
       t.area_id,
       ar.nombre       AS area_nombre,
       t.etapa_actual_id,
       ce.codigo       AS etapa_codigo,
       ce.nombre       AS etapa_nombre,
       ce.grupo        AS etapa_grupo,
       ce.equipo_id,
       eq.codigo       AS equipo_codigo,
       ce.sla_dias,
       t.en_etapa_desde,
       d.dias          AS dias_habiles_en_etapa,
       fn_semaforo(d.dias, ce.sla_dias) AS semaforo,
       d.dias >= ce.sla_dias            AS vencida,
       t.version,
       t.creado_en
FROM transacciones t
JOIN catalogo_etapas ce ON ce.id = t.etapa_actual_id
LEFT JOIN equipos eq    ON eq.id = ce.equipo_id
LEFT JOIN usuarios u    ON u.id = t.asignado_a
LEFT JOIN areas ar      ON ar.id = t.area_id
CROSS JOIN LATERAL (SELECT fn_dias_habiles(t.en_etapa_desde, now()) AS dias) d
WHERE t.estado = 'en_curso';

CREATE VIEW v_sla_vencidas AS
SELECT v.id AS transaccion_id,
       v.consecutivo,
       v.descripcion,
       v.facturas,
       v.valor,
       v.area_nombre,
       v.etapa_codigo,
       v.etapa_nombre,
       v.sla_dias,
       v.dias_habiles_en_etapa,
       v.dias_habiles_en_etapa - v.sla_dias AS dias_vencida,
       v.en_etapa_desde,
       CASE WHEN u.activo THEN jsonb_build_array(jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre))
            ELSE '[]'::jsonb END AS responsables,
       (SELECT jsonb_build_object('id', l.id, 'email', l.email, 'nombre', l.nombre)
          FROM usuarios l WHERE l.id = eq.lider_usuario_id AND l.activo AND l.id IS DISTINCT FROM v.asignado_a) AS escalar_a,
       v.dias_habiles_en_etapa - v.sla_dias
         >= coalesce((SELECT (valor #>> '{}')::int FROM configuracion
                      WHERE clave = 'escalamiento_dias_despues_de_vencer'), 0) AS escalar
FROM v_transacciones_en_curso v
LEFT JOIN usuarios u ON u.id = v.asignado_a
LEFT JOIN equipos eq ON eq.id = v.equipo_id
WHERE v.vencida;

GRANT SELECT, INSERT, UPDATE ON areas TO gastos_app;
GRANT SELECT, INSERT, DELETE ON usuario_area TO gastos_app;
GRANT USAGE ON SEQUENCE areas_id_seq TO gastos_app;
GRANT SELECT ON v_transacciones_en_curso, v_sla_vencidas TO gastos_app;
GRANT SELECT ON v_sla_vencidas TO gastos_n8n;

-- migrate:down

DROP VIEW v_sla_vencidas;
DROP VIEW v_transacciones_en_curso;
ALTER TABLE transacciones DROP COLUMN area_id;
DROP TABLE usuario_area;
DROP TABLE areas;

CREATE VIEW v_transacciones_en_curso AS
SELECT t.id,
       t.consecutivo,
       t.valor,
       t.descripcion,
       (SELECT string_agg(f.numero, ', ' ORDER BY f.id) FROM facturas f WHERE f.transaccion_id = t.id AND f.activa) AS facturas,
       t.solicitante_id,
       t.asignado_a,
       u.nombre        AS asignado_nombre,
       t.etapa_actual_id,
       ce.codigo       AS etapa_codigo,
       ce.nombre       AS etapa_nombre,
       ce.grupo        AS etapa_grupo,
       ce.equipo_id,
       eq.codigo       AS equipo_codigo,
       ce.sla_dias,
       t.en_etapa_desde,
       d.dias          AS dias_habiles_en_etapa,
       fn_semaforo(d.dias, ce.sla_dias) AS semaforo,
       d.dias >= ce.sla_dias            AS vencida,
       t.version,
       t.creado_en
FROM transacciones t
JOIN catalogo_etapas ce ON ce.id = t.etapa_actual_id
LEFT JOIN equipos eq    ON eq.id = ce.equipo_id
LEFT JOIN usuarios u    ON u.id = t.asignado_a
CROSS JOIN LATERAL (SELECT fn_dias_habiles(t.en_etapa_desde, now()) AS dias) d
WHERE t.estado = 'en_curso';

CREATE VIEW v_sla_vencidas AS
SELECT v.id AS transaccion_id,
       v.consecutivo,
       v.descripcion,
       v.facturas,
       v.valor,
       v.etapa_codigo,
       v.etapa_nombre,
       v.sla_dias,
       v.dias_habiles_en_etapa,
       v.dias_habiles_en_etapa - v.sla_dias AS dias_vencida,
       v.en_etapa_desde,
       CASE WHEN u.activo THEN jsonb_build_array(jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre))
            ELSE '[]'::jsonb END AS responsables,
       (SELECT jsonb_build_object('id', l.id, 'email', l.email, 'nombre', l.nombre)
          FROM usuarios l WHERE l.id = eq.lider_usuario_id AND l.activo AND l.id IS DISTINCT FROM v.asignado_a) AS escalar_a,
       v.dias_habiles_en_etapa - v.sla_dias
         >= coalesce((SELECT (valor #>> '{}')::int FROM configuracion
                      WHERE clave = 'escalamiento_dias_despues_de_vencer'), 0) AS escalar
FROM v_transacciones_en_curso v
LEFT JOIN usuarios u ON u.id = v.asignado_a
LEFT JOIN equipos eq ON eq.id = v.equipo_id
WHERE v.vencida;

GRANT SELECT ON v_transacciones_en_curso, v_sla_vencidas TO gastos_app;
GRANT SELECT ON v_sla_vencidas TO gastos_n8n;
