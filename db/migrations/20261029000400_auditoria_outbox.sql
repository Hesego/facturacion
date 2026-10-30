-- migrate:up

CREATE TYPE tipo_evento AS ENUM (
  'creada', 'avanzada', 'devuelta', 'anulada', 'cerrada',
  'dato_actualizado', 'referencia_registrada',
  'factura_agregada', 'factura_inactivada',
  'adjunto_agregado', 'adjunto_inactivado',
  'comentario'
);
CREATE TYPE estado_outbox       AS ENUM ('pendiente', 'enviado', 'fallido');
CREATE TYPE estado_notificacion AS ENUM ('pendiente', 'enviado', 'error', 'omitido');
CREATE TYPE canal_notificacion  AS ENUM ('correo', 'teams', 'slack', 'whatsapp');

-- ---------------------------------------------------------------------------
-- Eventos de auditoría: SOLO INSERCIÓN
-- ---------------------------------------------------------------------------
CREATE TABLE eventos (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaccion_id   bigint NOT NULL REFERENCES transacciones (id),
  tipo             tipo_evento NOT NULL,
  etapa_origen_id  bigint REFERENCES catalogo_etapas (id),
  etapa_destino_id bigint REFERENCES catalogo_etapas (id),
  actor_id         bigint REFERENCES usuarios (id),   -- NULL = sistema (p. ej. cierre FT)
  motivo           text,
  datos            jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(datos) = 'object'),
  -- Transacción de base de datos que lo registró: liga el evento con el cambio de estado
  txid             bigint NOT NULL DEFAULT txid_current(),
  ocurrido_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_motivo_ck
    CHECK (tipo NOT IN ('devuelta', 'anulada') OR length(btrim(coalesce(motivo, ''))) >= 5),
  CONSTRAINT eventos_transicion_ck
    CHECK (tipo NOT IN ('avanzada', 'devuelta', 'cerrada')
           OR (etapa_origen_id IS NOT NULL AND etapa_destino_id IS NOT NULL)),
  CONSTRAINT eventos_actor_ck CHECK (tipo = 'cerrada' OR actor_id IS NOT NULL)
);
CREATE INDEX eventos_transaccion_idx ON eventos (transaccion_id, id);
CREATE INDEX eventos_txid_idx ON eventos (txid);
CREATE INDEX eventos_actor_idx ON eventos (actor_id);

CREATE FUNCTION fn_solo_insercion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: no se permite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER eventos_solo_insercion BEFORE UPDATE OR DELETE ON eventos
  FOR EACH ROW EXECUTE FUNCTION fn_solo_insercion();
CREATE TRIGGER eventos_sin_truncate BEFORE TRUNCATE ON eventos
  FOR EACH STATEMENT EXECUTE FUNCTION fn_solo_insercion();
CREATE TRIGGER comentarios_solo_insercion BEFORE UPDATE OR DELETE ON comentarios
  FOR EACH ROW EXECUTE FUNCTION fn_solo_insercion();
CREATE TRIGGER comentarios_sin_truncate BEFORE TRUNCATE ON comentarios
  FOR EACH STATEMENT EXECUTE FUNCTION fn_solo_insercion();

-- ---------------------------------------------------------------------------
-- Outbox: eventos para n8n, insertados en la misma transacción que el cambio
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_eventos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id       bigint NOT NULL REFERENCES eventos (id),
  transaccion_id  bigint NOT NULL REFERENCES transacciones (id),
  tipo            text NOT NULL CHECK (tipo ~ '^[a-z_]+\.[a-z_]+$'),   -- p. ej. transaccion.avanzada
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  estado          estado_outbox NOT NULL DEFAULT 'pendiente',
  intentos        integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  procesado_en    timestamptz,
  ultimo_error    text,
  CONSTRAINT outbox_procesado_ck CHECK ((estado = 'enviado') = (procesado_en IS NOT NULL))
);
CREATE INDEX outbox_pendientes_idx ON outbox_eventos (proximo_intento) WHERE estado = 'pendiente';
CREATE INDEX outbox_evento_idx ON outbox_eventos (evento_id);

-- Despierta al relay de la API (LISTEN outbox_eventos); el relay también sondea por si acaso
CREATE FUNCTION fn_outbox_notificar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_eventos', NEW.id::text);
  RETURN NULL;
END $$;
CREATE TRIGGER outbox_eventos_notificar AFTER INSERT ON outbox_eventos
  FOR EACH ROW EXECUTE FUNCTION fn_outbox_notificar();

-- ---------------------------------------------------------------------------
-- Bitácora de notificaciones (la escribe n8n). La clave de idempotencia evita
-- enviar dos veces el mismo aviso aunque el evento se reintente.
-- ---------------------------------------------------------------------------
CREATE TABLE notificaciones_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clave_idempotencia text NOT NULL UNIQUE,
  outbox_evento_id   uuid REFERENCES outbox_eventos (id),
  transaccion_id     bigint REFERENCES transacciones (id),
  tipo               text NOT NULL,          -- nueva_etapa, cambio_solicitante, sla_recordatorio, sla_escalamiento, cierre
  canal              canal_notificacion NOT NULL,
  destinatario       text NOT NULL,
  asunto             text,
  estado             estado_notificacion NOT NULL DEFAULT 'pendiente',
  intentos           integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  error              text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  enviado_en         timestamptz
);
CREATE INDEX notificaciones_log_transaccion_idx ON notificaciones_log (transaccion_id);

-- ---------------------------------------------------------------------------
-- Integridad del ciclo de vida
-- ---------------------------------------------------------------------------

-- Regla 7: todo cambio de etapa o de estado va acompañado, en la MISMA transacción de base
-- de datos, de su evento de auditoría y de su registro en el outbox. Se verifica al COMMIT.
CREATE FUNCTION fn_exigir_auditoria_transicion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM eventos e
                   WHERE e.transaccion_id = NEW.id AND e.tipo = 'creada' AND e.txid = txid_current()) THEN
      RAISE EXCEPTION 'La transacción % se creó sin su evento de auditoría', NEW.consecutivo
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW.etapa_actual_id IS DISTINCT FROM OLD.etapa_actual_id OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT EXISTS (SELECT 1 FROM eventos e
                   JOIN outbox_eventos o ON o.evento_id = e.id
                   WHERE e.transaccion_id = NEW.id
                     AND e.tipo IN ('avanzada', 'devuelta', 'anulada', 'cerrada')
                     AND e.txid = txid_current()) THEN
      RAISE EXCEPTION 'La transacción % cambió de etapa o estado sin evento de auditoría y outbox', NEW.consecutivo
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER transacciones_exigir_auditoria
  AFTER INSERT OR UPDATE ON transacciones
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_exigir_auditoria_transicion();

-- Una transacción pagada o anulada ya no cambia
CREATE FUNCTION fn_transaccion_cerrada_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> 'en_curso' THEN
    RAISE EXCEPTION 'La transacción % está % y no admite cambios', OLD.consecutivo, OLD.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transacciones_cerrada_inmutable BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION fn_transaccion_cerrada_inmutable();

-- Al anular se liberan facturas y referencias (decisión 3). Los adjuntos se conservan como evidencia.
CREATE FUNCTION fn_liberar_al_anular() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'anulada' AND OLD.estado <> 'anulada' THEN
    UPDATE facturas SET activa = false, inactivada_en = now(), inactivada_motivo = 'anulacion'
     WHERE transaccion_id = NEW.id AND activa;
    UPDATE referencias SET activa = false, inactivada_en = now(), inactivada_motivo = 'anulacion'
     WHERE transaccion_id = NEW.id AND activa;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER transacciones_liberar_al_anular AFTER UPDATE OF estado ON transacciones
  FOR EACH ROW EXECUTE FUNCTION fn_liberar_al_anular();

-- No se agregan soportes a transacciones pagadas o anuladas
CREATE FUNCTION fn_exigir_transaccion_en_curso() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT estado FROM transacciones WHERE id = NEW.transaccion_id) <> 'en_curso' THEN
    RAISE EXCEPTION 'No se pueden registrar % en una transacción cerrada', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adjuntos_en_curso BEFORE INSERT ON adjuntos
  FOR EACH ROW EXECUTE FUNCTION fn_exigir_transaccion_en_curso();
CREATE TRIGGER facturas_en_curso BEFORE INSERT ON facturas
  FOR EACH ROW EXECUTE FUNCTION fn_exigir_transaccion_en_curso();
CREATE TRIGGER referencias_en_curso BEFORE INSERT ON referencias
  FOR EACH ROW EXECUTE FUNCTION fn_exigir_transaccion_en_curso();

-- migrate:down

DROP TRIGGER referencias_en_curso ON referencias;
DROP TRIGGER facturas_en_curso ON facturas;
DROP TRIGGER adjuntos_en_curso ON adjuntos;
DROP FUNCTION fn_exigir_transaccion_en_curso();
DROP TRIGGER transacciones_liberar_al_anular ON transacciones;
DROP FUNCTION fn_liberar_al_anular();
DROP TRIGGER transacciones_cerrada_inmutable ON transacciones;
DROP FUNCTION fn_transaccion_cerrada_inmutable();
DROP TRIGGER transacciones_exigir_auditoria ON transacciones;
DROP FUNCTION fn_exigir_auditoria_transicion();
DROP TABLE notificaciones_log;
DROP TABLE outbox_eventos;
DROP FUNCTION fn_outbox_notificar();
DROP TRIGGER comentarios_sin_truncate ON comentarios;
DROP TRIGGER comentarios_solo_insercion ON comentarios;
DROP TABLE eventos;
DROP FUNCTION fn_solo_insercion();
DROP TYPE canal_notificacion;
DROP TYPE estado_notificacion;
DROP TYPE estado_outbox;
DROP TYPE tipo_evento;
