-- Flujo inicial de un gasto. En cada paso quien envía elige a la persona del equipo siguiente.
-- Solo se carga si el catálogo está vacío, para no pisar cambios
-- hechos desde la administración. Los `orden` van de 10 en 10 para poder intercalar etapas.
--
--  SOL → RQ → AP → OC → AG → ES → PG_ENV → PG_APR → RP → FT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM catalogo_etapas) THEN
    RAISE NOTICE 'El catálogo de etapas ya tiene datos: no se modifica';
    RETURN;
  END IF;

  INSERT INTO catalogo_etapas
    (codigo, grupo, orden, nombre, tipo, equipo_id, sla_dias, segregacion, descripcion, requisitos)
  SELECT s.codigo, s.grupo, s.orden, s.nombre, s.tipo::tipo_etapa, eq.id,
         3, s.segregacion, s.descripcion, s.requisitos::jsonb
  FROM (VALUES
    ('SOL', 'SOL', 10, 'Solicitud de gasto', 'ejecucion', 'contabilidad', false,
     'Contabilidad sube la factura, su número y la envía a la persona de operaciones que atiende el gasto.',
     '{"facturas": {"min": 1}}'),

    ('RQ', 'RQ', 20, 'Requerimiento', 'ejecucion', 'operaciones', false,
     'Operaciones registra el número de RQ, adjunta el pantallazo de la operación y la envía al líder que aprueba.',
     '{"referencias": [{"tipo": "RQ", "etiqueta": "Número de RQ"}],
       "adjuntos": [{"tipo": "pantallazo_operacion", "etiqueta": "Pantallazo de la operación", "min": 1}]}'),

    ('AP', 'AP', 30, 'Aprobación del RQ', 'aprobacion', 'lider_operaciones', true,
     'El líder de operaciones aprueba o devuelve el RQ.',
     '{"comentario_obligatorio": true}'),

    ('OC', 'OC', 40, 'Orden de compra', 'ejecucion', 'compras', false,
     'Compras registra el número y el documento de la orden de compra.',
     '{"referencias": [{"tipo": "OC", "etiqueta": "Número de orden de compra"}],
       "adjuntos": [{"tipo": "documento_oc", "etiqueta": "Documento de la orden de compra", "min": 1}]}'),

    ('AG', 'AG', 50, 'Aprobación de la OC', 'aprobacion', 'gerencia', true,
     'Gerencia aprueba o devuelve la orden de compra.',
     '{"comentario_obligatorio": true}'),

    ('ES', 'ES', 60, 'Entrega de servicio', 'ejecucion', 'operaciones', false,
     'Operaciones registra el número de ES y adjunta la evidencia de la entrega.',
     '{"referencias": [{"tipo": "ES", "etiqueta": "Número de entrega de servicio"}],
       "adjuntos": [{"tipo": "evidencia_es", "etiqueta": "Evidencia de la entrega del servicio", "min": 1}]}'),

    ('PG_ENV', 'PG', 70, 'Envío a aprobación de pago', 'ejecucion', 'contabilidad', false,
     'Contabilidad envía a gerencia financiera la solicitud de pago con todos los soportes.',
     '{"referencias_previas": ["RQ", "OC", "ES"], "facturas": {"min": 1}}'),

    ('PG_APR', 'PG', 80, 'Aprobación de pago', 'aprobacion', 'gerencia_financiera', true,
     'Gerencia financiera aprueba o devuelve el pago.',
     '{"comentario_obligatorio": true}'),

    ('RP', 'RP', 90, 'Pago', 'ejecucion', 'contabilidad', false,
     'Contabilidad registra el pago y adjunta el comprobante.',
     '{"referencias": [{"tipo": "CP", "etiqueta": "Número del comprobante de pago"}],
       "adjuntos": [{"tipo": "comprobante_pago", "etiqueta": "Comprobante de pago", "min": 1}]}'),

    ('FT', 'FT', 100, 'Cierre', 'sistema', NULL, false,
     'El sistema cierra la transacción como pagada y notifica a todos los participantes.',
     '{}')
  ) AS s (codigo, grupo, orden, nombre, tipo, equipo, segregacion, descripcion, requisitos)
  LEFT JOIN equipos eq ON eq.codigo = s.equipo;

  -- Devolución por defecto: la etapa anterior. SOL no devuelve (es la primera) y FT es del sistema.
  UPDATE catalogo_etapas e
     SET etapa_devolucion_id = d.id
    FROM (VALUES ('RQ', 'SOL'), ('AP', 'RQ'), ('OC', 'AP'), ('AG', 'OC'), ('ES', 'AG'),
                 ('PG_ENV', 'ES'), ('PG_APR', 'PG_ENV'), ('RP', 'PG_APR')) AS m (etapa, destino)
    JOIN catalogo_etapas d ON d.codigo = m.destino
   WHERE e.codigo = m.etapa;
END $$;
