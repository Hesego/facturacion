-- migrate:up

-- Avisos solo al destinatario del paso (2026-11-05). Ya no se avisa a equipos completos
-- (contabilidad) ni al solicitante en cada cambio: eso generaba ruido. La configuración
-- «Quién recibe el seguimiento» deja de existir.
DELETE FROM configuracion WHERE clave = 'equipos_seguimiento';
