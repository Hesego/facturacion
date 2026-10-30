-- migrate:up

-- Simplificación acordada el 2026-10-29: la plataforma es de CONTROL y seguimiento, no de
-- proceso contable. Los datos contables (proveedor, NIT, CUFE…) viven en otra plataforma:
--   · La solicitud es: factura (PDF y, si lo hay, el ZIP/XML de la DIAN) + número + a quién se envía.
--   · Cada transacción queda asignada a UNA persona del equipo de su etapa (la elige quien envía).
--   · Desaparecen áreas y proveedores. Valor y descripción quedan opcionales.

DROP VIEW v_sla_vencidas;
DROP VIEW v_transacciones_en_curso;
DROP FUNCTION fn_escalamiento_etapa(bigint, bigint);
DROP FUNCTION fn_responsables_etapa(bigint, bigint);

-- ---------------------------------------------------------------------------
-- Transacciones
-- ---------------------------------------------------------------------------
ALTER TABLE transacciones DROP COLUMN area_id;
ALTER TABLE transacciones DROP COLUMN proveedor_id;
ALTER TABLE transacciones ALTER COLUMN valor DROP NOT NULL;
ALTER TABLE transacciones DROP CONSTRAINT transacciones_descripcion_check;
ALTER TABLE transacciones ALTER COLUMN descripcion DROP NOT NULL;
ALTER TABLE transacciones ADD CONSTRAINT transacciones_descripcion_ck
  CHECK (descripcion IS NULL OR (btrim(descripcion) <> '' AND length(descripcion) <= 200));
-- Persona que debe actuar ahora. NULL solo en la etapa del sistema y en transacciones cerradas.
ALTER TABLE transacciones ADD COLUMN asignado_a bigint REFERENCES usuarios (id);
CREATE INDEX transacciones_asignado_idx ON transacciones (asignado_a) WHERE estado = 'en_curso';

-- ---------------------------------------------------------------------------
-- Facturas: el usuario solo da el número y el archivo. NIT, CUFE, valor, fecha y nombre del
-- proveedor se llenan solos cuando adjuntan el XML de la factura electrónica.
-- ---------------------------------------------------------------------------
ALTER TABLE facturas ALTER COLUMN proveedor_nit DROP NOT NULL;
ALTER TABLE facturas ALTER COLUMN fecha DROP NOT NULL;
ALTER TABLE facturas ALTER COLUMN valor DROP NOT NULL;
ALTER TABLE facturas ALTER COLUMN cufe DROP NOT NULL;
ALTER TABLE facturas ADD COLUMN proveedor_nombre text;
ALTER TABLE facturas ADD COLUMN xml_adjunto_id bigint REFERENCES adjuntos (id);
-- El mismo PDF no se registra dos veces como factura activa
CREATE UNIQUE INDEX adjuntos_factura_sha_uq ON adjuntos (sha256) WHERE activo AND tipo = 'factura';
CREATE INDEX facturas_numero_idx ON facturas (upper(numero)) WHERE activa;

-- ---------------------------------------------------------------------------
-- Sin áreas ni proveedores
-- ---------------------------------------------------------------------------
ALTER TABLE catalogo_etapas DROP CONSTRAINT catalogo_etapas_sistema_sin_area_ck;
ALTER TABLE catalogo_etapas DROP COLUMN restriccion_area;
DROP TABLE usuario_area;
DROP TABLE areas;
DROP TABLE proveedores;
DROP TYPE restriccion_area;

-- ---------------------------------------------------------------------------
-- Reasignar (vacaciones, ausencias) también queda auditado y notificado
-- ---------------------------------------------------------------------------
ALTER TYPE tipo_evento ADD VALUE IF NOT EXISTS 'reasignada';

CREATE OR REPLACE FUNCTION fn_exigir_auditoria_transicion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM eventos e
                   WHERE e.transaccion_id = NEW.id AND e.tipo = 'creada' AND e.txid = txid_current()) THEN
      RAISE EXCEPTION 'La transacción % se creó sin su evento de auditoría', NEW.consecutivo
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW.etapa_actual_id IS DISTINCT FROM OLD.etapa_actual_id
     OR NEW.estado IS DISTINCT FROM OLD.estado
     OR NEW.asignado_a IS DISTINCT FROM OLD.asignado_a THEN
    IF NOT EXISTS (SELECT 1 FROM eventos e
                   JOIN outbox_eventos o ON o.evento_id = e.id
                   WHERE e.transaccion_id = NEW.id
                     AND e.tipo::text IN ('avanzada', 'devuelta', 'anulada', 'cerrada', 'reasignada')
                     AND e.txid = txid_current()) THEN
      RAISE EXCEPTION 'La transacción % cambió de etapa, estado o responsable sin evento de auditoría y outbox', NEW.consecutivo
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------------
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

-- Recordatorio diario de n8n: la persona asignada recibe el recordatorio y el líder del equipo
-- de la etapa, el escalamiento.
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

-- migrate:down

-- Irreversible: elimina áreas y proveedores. Restaure un respaldo si necesita volver atrás.
DO $$ BEGIN RAISE EXCEPTION 'La migración de simplificación no tiene reversa: restaure un respaldo'; END $$;
