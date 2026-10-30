INSERT INTO equipos (codigo, nombre, descripcion) VALUES
  ('contabilidad',        'Contabilidad',              'Dueña del proceso de punta a punta: solicita, envía a aprobación de pago y paga'),
  ('operaciones',         'Operaciones',               'Equipos de operaciones (ver áreas): registran el RQ y la entrega del servicio'),
  ('lider_operaciones',   'Líderes de operaciones',    'El líder aprobador de cada área aprueba el RQ'),
  ('compras',             'Compras',                   'Emite la orden de compra'),
  ('gerencia',            'Gerencia',                  'Aprueba la orden de compra'),
  ('gerencia_financiera', 'Gerencia financiera',       'Aprueba el pago'),
  ('administrador',       'Administrador',             'Administra usuarios, equipos, áreas, proveedores y etapas; puede anular')
ON CONFLICT (codigo) DO NOTHING;
