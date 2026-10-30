-- DATOS DE PRUEBA. No usar en producción (SEED_DEMO=false).
-- Todos los usuarios usan la clave DEMO_PASSWORD (por defecto Hesego2026*).

INSERT INTO usuarios (email, nombre, cargo, password_hash)
SELECT v.email, v.nombre, v.cargo, crypt(:'demo_password', gen_salt('bf', 10))
FROM (VALUES
  ('contabilidad1@hesego.test',  'Carolina Ruiz',    'Analista contable'),
  ('contabilidad2@hesego.test',  'Andrés Mejía',     'Auxiliar contable'),
  ('ops.sst@hesego.test',        'Julián Ortiz',     'Coordinador SST'),
  ('ops.tics@hesego.test',       'Natalia Gómez',    'Analista TIC'),
  ('ops.inventario@hesego.test', 'Felipe Rojas',     'Almacenista'),
  ('lider.sst@hesego.test',      'Marcela Díaz',     'Líder SST'),
  ('lider.tics@hesego.test',     'Santiago Vargas',  'Líder TIC'),
  ('lider.inventario@hesego.test','Paula Herrera',   'Líder de inventario'),
  ('compras1@hesego.test',       'Diego Castro',     'Analista de compras'),
  ('gerencia1@hesego.test',      'Ricardo Salazar',  'Gerente general'),
  ('gfinanciera1@hesego.test',   'Lucía Ramírez',    'Gerente financiera'),
  -- Pertenece a contabilidad y a gerencia financiera: sirve para probar la segregación de funciones
  ('doble.rol@hesego.test',      'Camilo Torres',    'Contador y suplente de gerencia financiera')
) AS v (email, nombre, cargo)
ON CONFLICT (email) DO NOTHING;

INSERT INTO usuario_equipo (usuario_id, equipo_id)
SELECT u.id, e.id
FROM (VALUES
  ('contabilidad1@hesego.test',   'contabilidad'),
  ('contabilidad2@hesego.test',   'contabilidad'),
  ('ops.sst@hesego.test',         'operaciones'),
  ('ops.tics@hesego.test',        'operaciones'),
  ('ops.inventario@hesego.test',  'operaciones'),
  ('lider.sst@hesego.test',       'lider_operaciones'),
  ('lider.tics@hesego.test',      'lider_operaciones'),
  ('lider.inventario@hesego.test','lider_operaciones'),
  ('compras1@hesego.test',        'compras'),
  ('gerencia1@hesego.test',       'gerencia'),
  ('gfinanciera1@hesego.test',    'gerencia_financiera'),
  ('doble.rol@hesego.test',       'contabilidad'),
  ('doble.rol@hesego.test',       'gerencia_financiera')
) AS m (email, equipo)
JOIN usuarios u ON u.email = m.email
JOIN equipos e  ON e.codigo = m.equipo
ON CONFLICT DO NOTHING;

-- Líderes de equipo: reciben el escalamiento cuando una etapa de su equipo vence. Solo si aún no tienen uno.
UPDATE equipos e
   SET lider_usuario_id = u.id
  FROM (VALUES
    ('contabilidad',        'contabilidad1@hesego.test'),
    ('operaciones',         'lider.sst@hesego.test'),
    ('lider_operaciones',   'gerencia1@hesego.test'),
    ('compras',             'compras1@hesego.test'),
    ('gerencia',            'gerencia1@hesego.test'),
    ('gerencia_financiera', 'gfinanciera1@hesego.test')
  ) AS m (equipo, email)
  JOIN usuarios u ON u.email = m.email
 WHERE e.codigo = m.equipo AND e.lider_usuario_id IS NULL;

-- Áreas de ejemplo dentro de los equipos de operaciones y de líderes (se administran en la aplicación)
INSERT INTO areas (equipo_id, codigo, nombre)
SELECT e.id, a.codigo, a.nombre
FROM (VALUES ('SST', 'Seguridad y salud en el trabajo'), ('TICS', 'Tecnologías de la información'), ('INVENTARIO', 'Inventario y almacén')) AS a (codigo, nombre)
CROSS JOIN equipos e
WHERE e.codigo IN ('operaciones', 'lider_operaciones')
ON CONFLICT (equipo_id, codigo) DO NOTHING;

INSERT INTO usuario_area (usuario_id, area_id)
SELECT u.id, ar.id
FROM (VALUES
  ('ops.sst@hesego.test',          'operaciones',       'SST'),
  ('ops.tics@hesego.test',         'operaciones',       'TICS'),
  ('ops.inventario@hesego.test',   'operaciones',       'INVENTARIO'),
  ('lider.sst@hesego.test',        'lider_operaciones', 'SST'),
  ('lider.tics@hesego.test',       'lider_operaciones', 'TICS'),
  ('lider.inventario@hesego.test', 'lider_operaciones', 'INVENTARIO')
) AS m (email, equipo, area)
JOIN usuarios u ON u.email = m.email
JOIN equipos e  ON e.codigo = m.equipo
JOIN areas ar   ON ar.equipo_id = e.id AND ar.codigo = m.area
ON CONFLICT DO NOTHING;
