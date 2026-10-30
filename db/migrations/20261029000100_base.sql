-- migrate:up

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
CREATE TYPE estado_transaccion  AS ENUM ('en_curso', 'pagada', 'anulada');
CREATE TYPE tipo_etapa          AS ENUM ('ejecucion', 'aprobacion', 'sistema');
-- Quién del equipo responsable puede actuar, según el área de la transacción
CREATE TYPE restriccion_area    AS ENUM ('ninguna', 'miembro_area', 'lider_area');
CREATE TYPE tipo_referencia     AS ENUM ('RQ', 'OC', 'ES', 'CP');
CREATE TYPE motivo_inactivacion AS ENUM ('reemplazo', 'anulacion', 'error_registro');

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_set_actualizado_en() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

-- Dígito de verificación del NIT (algoritmo DIAN, módulo 11)
CREATE FUNCTION fn_nit_dv(p_nit text) RETURNS smallint
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  pesos constant int[] := ARRAY[3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  n     int := length(p_nit);
  suma  int := 0;
  r     int;
BEGIN
  IF p_nit !~ '^[0-9]{1,15}$' THEN
    RETURN NULL;
  END IF;
  FOR i IN 1..n LOOP
    suma := suma + substr(p_nit, n - i + 1, 1)::int * pesos[i];
  END LOOP;
  r := suma % 11;
  RETURN CASE WHEN r IN (0, 1) THEN r ELSE 11 - r END;
END $$;

-- ---------------------------------------------------------------------------
-- Configuración general (clave → valor JSON)
-- ---------------------------------------------------------------------------
CREATE TABLE configuracion (
  clave          text PRIMARY KEY CHECK (clave ~ '^[a-z][a-z0-9_]*$'),
  valor          jsonb NOT NULL,
  descripcion    text NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER configuracion_actualizado_en BEFORE UPDATE ON configuracion
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- ---------------------------------------------------------------------------
-- Usuarios y equipos
-- ---------------------------------------------------------------------------
CREATE TABLE usuarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          citext NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nombre         text NOT NULL CHECK (btrim(nombre) <> ''),
  cargo          text,
  -- 'microsoft' queda listo para el inicio de sesión con Entra ID (Microsoft 365)
  proveedor_auth text NOT NULL DEFAULT 'local' CHECK (proveedor_auth IN ('local', 'microsoft')),
  password_hash  text,
  microsoft_oid  uuid UNIQUE,
  activo         boolean NOT NULL DEFAULT true,
  ultimo_acceso  timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_local_con_clave_ck
    CHECK (proveedor_auth <> 'local' OR password_hash IS NOT NULL)
);
CREATE TRIGGER usuarios_actualizado_en BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

CREATE TABLE equipos (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo           text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z][a-z_]*$'),
  nombre           text NOT NULL,
  descripcion      text,
  -- A quién se escala el SLA vencido de las etapas de este equipo
  lider_usuario_id bigint REFERENCES usuarios (id),
  activo           boolean NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER equipos_actualizado_en BEFORE UPDATE ON equipos
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

CREATE TABLE usuario_equipo (
  usuario_id  bigint NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  equipo_id   bigint NOT NULL REFERENCES equipos (id) ON DELETE CASCADE,
  asignado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, equipo_id)
);
CREATE INDEX usuario_equipo_equipo_idx ON usuario_equipo (equipo_id);

-- Áreas = equipos de operaciones (SST, TICS, Inventario…). Lista abierta y administrable.
CREATE TABLE areas (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo             text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z][A-Z0-9_]*$'),
  nombre             text NOT NULL,
  descripcion        text,
  -- Único usuario que puede aprobar el RQ (etapa AP) de las transacciones del área
  lider_aprobador_id bigint REFERENCES usuarios (id),
  activa             boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER areas_actualizado_en BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- Miembros de operaciones por área: solo ellos ejecutan RQ y ES de esa área
CREATE TABLE usuario_area (
  usuario_id  bigint NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  area_id     bigint NOT NULL REFERENCES areas (id) ON DELETE CASCADE,
  asignado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, area_id)
);
CREATE INDEX usuario_area_area_idx ON usuario_area (area_id);

-- ---------------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------------
CREATE TABLE proveedores (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nit            text NOT NULL UNIQUE CHECK (nit ~ '^[0-9]{5,15}$'),
  dv             smallint NOT NULL,
  razon_social   text NOT NULL CHECK (btrim(razon_social) <> ''),
  correo         citext,
  telefono       text,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proveedores_dv_ck CHECK (dv = fn_nit_dv(nit))
);
CREATE TRIGGER proveedores_actualizado_en BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- ---------------------------------------------------------------------------
-- Calendario: festivos de Colombia y días hábiles
-- ---------------------------------------------------------------------------
CREATE TABLE festivos (
  fecha  date PRIMARY KEY,
  nombre text NOT NULL
);

CREATE FUNCTION fn_siguiente_lunes(p date) RETURNS date
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT p + ((8 - extract(dow FROM p)::int) % 7);
$$;

-- Festivos de Colombia de un año (Ley 51 de 1983, «Ley Emiliani»)
CREATE FUNCTION fn_festivos_colombia(p_anio int)
RETURNS TABLE (fecha date, nombre text)
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
  pascua date;
BEGIN
  -- Domingo de Pascua (algoritmo gregoriano anónimo)
  a := p_anio % 19;  b := p_anio / 100;  c := p_anio % 100;
  d := b / 4;  e := b % 4;  f := (b + 8) / 25;  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  pascua := make_date(p_anio, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);

  RETURN QUERY VALUES
    (make_date(p_anio, 1, 1),                      'Año Nuevo'),
    (fn_siguiente_lunes(make_date(p_anio, 1, 6)),  'Día de los Reyes Magos'),
    (fn_siguiente_lunes(make_date(p_anio, 3, 19)), 'Día de San José'),
    (pascua - 3,                                   'Jueves Santo'),
    (pascua - 2,                                   'Viernes Santo'),
    (make_date(p_anio, 5, 1),                      'Día del Trabajo'),
    (pascua + 43,                                  'Ascensión del Señor'),
    (pascua + 64,                                  'Corpus Christi'),
    (pascua + 71,                                  'Sagrado Corazón'),
    (fn_siguiente_lunes(make_date(p_anio, 6, 29)), 'San Pedro y San Pablo'),
    (make_date(p_anio, 7, 20),                     'Día de la Independencia'),
    (make_date(p_anio, 8, 7),                      'Batalla de Boyacá'),
    (fn_siguiente_lunes(make_date(p_anio, 8, 15)), 'Asunción de la Virgen'),
    (fn_siguiente_lunes(make_date(p_anio, 10, 12)),'Día de la Raza'),
    (fn_siguiente_lunes(make_date(p_anio, 11, 1)), 'Todos los Santos'),
    (fn_siguiente_lunes(make_date(p_anio, 11, 11)),'Independencia de Cartagena'),
    (make_date(p_anio, 12, 8),                     'Inmaculada Concepción'),
    (make_date(p_anio, 12, 25),                    'Navidad');
END $$;

CREATE FUNCTION fn_es_dia_habil(p date) RETURNS boolean
LANGUAGE sql STABLE STRICT AS $$
  SELECT extract(isodow FROM p) < 6
     AND NOT EXISTS (SELECT 1 FROM festivos f WHERE f.fecha = p);
$$;

-- Días hábiles transcurridos entre dos instantes (hora de Colombia).
-- Mismo día hábil = 0; si se entra un sábado y se atiende el lunes, también es 0.
CREATE FUNCTION fn_dias_habiles(p_desde timestamptz, p_hasta timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = public AS $$
  SELECT greatest(count(*)::int - 1, 0)
  FROM generate_series((p_desde AT TIME ZONE 'America/Bogota')::date::timestamp,
                       (p_hasta AT TIME ZONE 'America/Bogota')::date::timestamp,
                       interval '1 day') AS g(dia)
  WHERE fn_es_dia_habil(g.dia::date);
$$;

-- migrate:down

DROP FUNCTION fn_dias_habiles(timestamptz, timestamptz);
DROP FUNCTION fn_es_dia_habil(date);
DROP FUNCTION fn_festivos_colombia(int);
DROP FUNCTION fn_siguiente_lunes(date);
DROP TABLE festivos;
DROP TABLE proveedores;
DROP TABLE usuario_area;
DROP TABLE areas;
DROP TABLE usuario_equipo;
DROP TABLE equipos;
DROP TABLE usuarios;
DROP TABLE configuracion;
DROP FUNCTION fn_nit_dv(text);
DROP FUNCTION fn_set_actualizado_en();
DROP TYPE motivo_inactivacion;
DROP TYPE tipo_referencia;
DROP TYPE restriccion_area;
DROP TYPE tipo_etapa;
DROP TYPE estado_transaccion;
