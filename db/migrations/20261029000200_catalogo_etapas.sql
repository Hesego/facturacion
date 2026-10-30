-- migrate:up

-- El flujo se define aquí, no en el código. La etapa siguiente es la activa con el
-- siguiente `orden`; la de devolución se configura por etapa.
--
-- `requisitos` (validado por la API) admite:
--   campos              ["proveedor","valor","descripcion","area"]  datos de la transacción
--   referencias         [{"tipo":"RQ","etiqueta":"Número de RQ"}]     a registrar en la etapa
--   referencias_previas ["RQ","OC","ES"]                              deben existir para avanzar
--   adjuntos            [{"tipo":"pantallazo_operacion","etiqueta":"…","min":1}]
--   facturas            {"min":1,"suma_igual_valor":true}
--   comentario_obligatorio true                                       al aprobar / avanzar
CREATE TABLE catalogo_etapas (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo              text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  nombre              text NOT NULL,
  descripcion         text,
  -- Agrupa subetapas en la interfaz (PG_ENV y PG_APR se muestran como «PG»)
  grupo               text NOT NULL,
  orden               integer NOT NULL CHECK (orden > 0),
  tipo                tipo_etapa NOT NULL,
  equipo_id           bigint REFERENCES equipos (id),
  restriccion_area    restriccion_area NOT NULL DEFAULT 'ninguna',
  -- Días hábiles a partir de los cuales la etapa está vencida (semáforo rojo)
  sla_dias            smallint NOT NULL DEFAULT 3 CHECK (sla_dias BETWEEN 1 AND 60),
  -- NULL = la etapa no admite devolución
  etapa_devolucion_id bigint REFERENCES catalogo_etapas (id),
  -- Quien llevó la transacción a esta etapa no puede avanzarla (segregación de funciones)
  segregacion         boolean NOT NULL DEFAULT false,
  requisitos          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(requisitos) = 'object'),
  activa              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  -- Diferible para poder reordenar etapas en una sola transacción
  CONSTRAINT catalogo_etapas_orden_uq UNIQUE (orden) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT catalogo_etapas_sistema_sin_equipo_ck CHECK ((tipo = 'sistema') = (equipo_id IS NULL)),
  CONSTRAINT catalogo_etapas_sistema_sin_area_ck CHECK (tipo <> 'sistema' OR restriccion_area = 'ninguna'),
  CONSTRAINT catalogo_etapas_devolucion_ck CHECK (etapa_devolucion_id IS DISTINCT FROM id)
);
CREATE TRIGGER catalogo_etapas_actualizado_en BEFORE UPDATE ON catalogo_etapas
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- La devolución siempre apunta a una etapa anterior del flujo
CREATE FUNCTION fn_validar_catalogo_etapa() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_orden_devolucion integer;
BEGIN
  IF NEW.etapa_devolucion_id IS NOT NULL THEN
    SELECT orden INTO v_orden_devolucion FROM catalogo_etapas WHERE id = NEW.etapa_devolucion_id;
    IF v_orden_devolucion >= NEW.orden THEN
      RAISE EXCEPTION 'La etapa % solo puede devolver a una etapa anterior del flujo', NEW.codigo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER catalogo_etapas_validar
  AFTER INSERT OR UPDATE ON catalogo_etapas
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_validar_catalogo_etapa();

-- migrate:down

DROP TABLE catalogo_etapas;
DROP FUNCTION fn_validar_catalogo_etapa();
