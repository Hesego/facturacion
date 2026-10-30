-- migrate:up

-- Mínimo privilegio. El dueño (gastos_owner) ejecuta migraciones; la aplicación y n8n
-- tienen roles propios. Aunque alguien obtenga la clave de la app, no puede borrar ni
-- editar el historial (además lo impiden los triggers de solo inserción).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gastos_app') THEN
    RAISE EXCEPTION 'Falta el rol gastos_app: ejecute db/init/01-roles-y-bases.sh';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gastos_n8n') THEN
    RAISE EXCEPTION 'Falta el rol gastos_n8n: ejecute db/init/01-roles-y-bases.sh';
  END IF;
END $$;

-- Aplicación
GRANT SELECT, INSERT, UPDATE ON
  configuracion, usuarios, equipos, areas, proveedores, festivos, catalogo_etapas,
  consecutivos, transacciones, adjuntos, referencias, facturas, outbox_eventos
TO gastos_app;
GRANT DELETE ON usuario_equipo, usuario_area TO gastos_app;
GRANT SELECT, INSERT ON usuario_equipo, usuario_area, eventos, comentarios TO gastos_app;
GRANT SELECT ON notificaciones_log, v_transacciones_en_curso, v_sla_vencidas TO gastos_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO gastos_app;

-- n8n: lee las vistas de SLA y registra sus envíos; nada más
GRANT SELECT ON v_sla_vencidas TO gastos_n8n;
GRANT SELECT, INSERT, UPDATE ON notificaciones_log TO gastos_n8n;
GRANT USAGE ON SEQUENCE notificaciones_log_id_seq TO gastos_n8n;

-- migrate:down

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM gastos_app, gastos_n8n;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM gastos_app, gastos_n8n;
