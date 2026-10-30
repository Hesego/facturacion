-- Festivos de Colombia calculados con la Ley Emiliani. Revise cada año por si hay
-- festivos extraordinarios decretados por el Gobierno y agréguelos a mano en esta tabla.
INSERT INTO festivos (fecha, nombre)
SELECT f.fecha, f.nombre
FROM generate_series(2025, 2035) AS anio
CROSS JOIN LATERAL fn_festivos_colombia(anio) AS f
ON CONFLICT (fecha) DO NOTHING;
