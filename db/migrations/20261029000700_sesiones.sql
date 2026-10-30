-- migrate:up

-- Sesiones de la aplicación. La cookie lleva un token aleatorio; aquí solo se guarda su
-- SHA-256, de modo que una copia de la base no permite suplantar sesiones.
CREATE TABLE sesiones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  usuario_id  bigint NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  revocada_en timestamptz,
  ip          text,
  user_agent  text,
  CHECK (expira_en > creada_en)
);
CREATE INDEX sesiones_usuario_idx ON sesiones (usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON sesiones TO gastos_app;

-- migrate:down

DROP TABLE sesiones;
