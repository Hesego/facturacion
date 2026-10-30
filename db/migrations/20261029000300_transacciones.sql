-- migrate:up

-- ---------------------------------------------------------------------------
-- Consecutivo interno: GTO-2026-000001 (reinicia cada año; prefijo configurable)
-- ---------------------------------------------------------------------------
CREATE TABLE consecutivos (
  anio   smallint PRIMARY KEY,
  ultimo integer NOT NULL CHECK (ultimo > 0)
);

CREATE FUNCTION fn_siguiente_consecutivo() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_anio    smallint := extract(year FROM now() AT TIME ZONE 'America/Bogota');
  v_prefijo text;
  v_numero  integer;
BEGIN
  SELECT valor #>> '{}' INTO v_prefijo FROM configuracion WHERE clave = 'consecutivo_prefijo';
  -- La fila del año queda bloqueada hasta el fin de la transacción: no hay números repetidos
  INSERT INTO consecutivos AS c (anio, ultimo) VALUES (v_anio, 1)
  ON CONFLICT (anio) DO UPDATE SET ultimo = c.ultimo + 1
  RETURNING ultimo INTO v_numero;
  RETURN format('%s-%s-%s', coalesce(v_prefijo, 'GTO'), v_anio, lpad(v_numero::text, 6, '0'));
END $$;

-- ---------------------------------------------------------------------------
-- Transacciones (gastos)
-- ---------------------------------------------------------------------------
CREATE TABLE transacciones (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consecutivo     text NOT NULL UNIQUE DEFAULT fn_siguiente_consecutivo(),
  area_id         bigint NOT NULL REFERENCES areas (id),
  proveedor_id    bigint NOT NULL REFERENCES proveedores (id),
  valor           numeric(18, 2) NOT NULL CHECK (valor > 0),
  moneda          char(3) NOT NULL DEFAULT 'COP' CHECK (moneda = 'COP'),
  descripcion     text NOT NULL CHECK (length(btrim(descripcion)) >= 5),
  etapa_actual_id bigint NOT NULL REFERENCES catalogo_etapas (id),
  estado          estado_transaccion NOT NULL DEFAULT 'en_curso',
  solicitante_id  bigint NOT NULL REFERENCES usuarios (id),
  en_etapa_desde  timestamptz NOT NULL DEFAULT now(),
  -- Bloqueo optimista: cada transición incrementa la versión
  version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  cerrado_en      timestamptz,
  CONSTRAINT transacciones_cierre_ck CHECK ((estado = 'en_curso') = (cerrado_en IS NULL))
);
CREATE TRIGGER transacciones_actualizado_en BEFORE UPDATE ON transacciones
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
CREATE INDEX transacciones_en_curso_idx ON transacciones (etapa_actual_id) WHERE estado = 'en_curso';
CREATE INDEX transacciones_area_idx ON transacciones (area_id);
CREATE INDEX transacciones_solicitante_idx ON transacciones (solicitante_id);
CREATE INDEX transacciones_proveedor_idx ON transacciones (proveedor_id);

-- ---------------------------------------------------------------------------
-- Adjuntos: solo metadatos y la referencia al objeto en S3, nunca el binario.
-- No se borran: un reemplazo o una anulación los inactiva.
-- ---------------------------------------------------------------------------
CREATE TABLE adjuntos (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaccion_id    bigint NOT NULL REFERENCES transacciones (id),
  etapa_id          bigint NOT NULL REFERENCES catalogo_etapas (id),
  tipo              text NOT NULL CHECK (tipo ~ '^[a-z][a-z0-9_]*$'),
  nombre_original   text NOT NULL CHECK (btrim(nombre_original) <> ''),
  mime              text NOT NULL,
  tamano_bytes      bigint NOT NULL CHECK (tamano_bytes > 0),
  sha256            char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bucket            text NOT NULL,
  object_key        text NOT NULL,
  subido_por        bigint NOT NULL REFERENCES usuarios (id),
  subido_en         timestamptz NOT NULL DEFAULT now(),
  activo            boolean NOT NULL DEFAULT true,
  inactivado_en     timestamptz,
  inactivado_motivo motivo_inactivacion,
  CONSTRAINT adjuntos_objeto_uq UNIQUE (bucket, object_key),
  CONSTRAINT adjuntos_inactivacion_ck
    CHECK (activo = (inactivado_en IS NULL) AND activo = (inactivado_motivo IS NULL))
);
CREATE INDEX adjuntos_transaccion_idx ON adjuntos (transaccion_id, etapa_id) WHERE activo;

-- ---------------------------------------------------------------------------
-- Referencias externas: número de RQ, OC, ES y comprobante de pago (CP)
-- ---------------------------------------------------------------------------
CREATE TABLE referencias (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaccion_id    bigint NOT NULL REFERENCES transacciones (id),
  tipo              tipo_referencia NOT NULL,
  numero            text NOT NULL CHECK (numero ~ '^\S(.*\S)?$' AND length(numero) <= 40),
  etapa_id          bigint NOT NULL REFERENCES catalogo_etapas (id),
  registrada_por    bigint NOT NULL REFERENCES usuarios (id),
  registrada_en     timestamptz NOT NULL DEFAULT now(),
  activa            boolean NOT NULL DEFAULT true,
  inactivada_en     timestamptz,
  inactivada_motivo motivo_inactivacion,
  CONSTRAINT referencias_inactivacion_ck
    CHECK (activa = (inactivada_en IS NULL) AND activa = (inactivada_motivo IS NULL))
);
-- Único en todo el sistema por tipo; una referencia activa por tipo en cada transacción
CREATE UNIQUE INDEX referencias_numero_uq ON referencias (tipo, upper(numero)) WHERE activa;
CREATE UNIQUE INDEX referencias_por_transaccion_uq ON referencias (transaccion_id, tipo) WHERE activa;

-- ---------------------------------------------------------------------------
-- Facturas. Duplicado = mismo CUFE, o mismo número + NIT del proveedor, en todo el
-- sistema. Las facturas de transacciones anuladas se inactivan y quedan liberadas.
-- ---------------------------------------------------------------------------
CREATE TABLE facturas (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaccion_id    bigint NOT NULL REFERENCES transacciones (id),
  etapa_id          bigint NOT NULL REFERENCES catalogo_etapas (id),
  numero            text NOT NULL CHECK (numero ~ '^\S(.*\S)?$' AND length(numero) <= 40),
  proveedor_nit     text NOT NULL CHECK (proveedor_nit ~ '^[0-9]{5,15}$'),
  fecha             date NOT NULL,
  valor             numeric(18, 2) NOT NULL CHECK (valor > 0),
  -- CUFE de la factura electrónica DIAN: SHA-384 en hexadecimal (96 caracteres)
  cufe              text NOT NULL CHECK (cufe ~ '^[0-9a-f]{96}$'),
  adjunto_id        bigint NOT NULL REFERENCES adjuntos (id),
  registrada_por    bigint NOT NULL REFERENCES usuarios (id),
  registrada_en     timestamptz NOT NULL DEFAULT now(),
  activa            boolean NOT NULL DEFAULT true,
  inactivada_en     timestamptz,
  inactivada_motivo motivo_inactivacion,
  CONSTRAINT facturas_inactivacion_ck
    CHECK (activa = (inactivada_en IS NULL) AND activa = (inactivada_motivo IS NULL))
);
CREATE UNIQUE INDEX facturas_cufe_uq ON facturas (cufe) WHERE activa;
CREATE UNIQUE INDEX facturas_nit_numero_uq ON facturas (proveedor_nit, upper(numero)) WHERE activa;
CREATE INDEX facturas_transaccion_idx ON facturas (transaccion_id) WHERE activa;

-- ---------------------------------------------------------------------------
-- Comentarios (solo inserción; ver migración de auditoría)
-- ---------------------------------------------------------------------------
CREATE TABLE comentarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaccion_id bigint NOT NULL REFERENCES transacciones (id),
  etapa_id       bigint NOT NULL REFERENCES catalogo_etapas (id),
  autor_id       bigint NOT NULL REFERENCES usuarios (id),
  texto          text NOT NULL CHECK (btrim(texto) <> '' AND length(texto) <= 4000),
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comentarios_transaccion_idx ON comentarios (transaccion_id, creado_en);

-- migrate:down

DROP TABLE comentarios;
DROP TABLE facturas;
DROP TABLE referencias;
DROP TABLE adjuntos;
DROP TABLE transacciones;
DROP FUNCTION fn_siguiente_consecutivo();
DROP TABLE consecutivos;
