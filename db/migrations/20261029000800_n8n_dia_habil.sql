-- migrate:up

-- El recordatorio diario de SLA (n8n) no se envía en fines de semana ni festivos.
-- SECURITY DEFINER: n8n no tiene acceso a la tabla de festivos, solo a esta respuesta.
CREATE FUNCTION fn_hoy_es_habil() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fn_es_dia_habil((now() AT TIME ZONE 'America/Bogota')::date);
$$;

REVOKE EXECUTE ON FUNCTION fn_hoy_es_habil() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_hoy_es_habil() TO gastos_n8n, gastos_app;

-- migrate:down

DROP FUNCTION fn_hoy_es_habil();
