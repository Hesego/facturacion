-- Administrador inicial, con los datos de ADMIN_EMAIL / ADMIN_NOMBRE / ADMIN_PASSWORD.
-- Si ya existe no se toca (la contraseña se cambia desde la aplicación).
INSERT INTO usuarios (email, nombre, cargo, password_hash)
VALUES (:'admin_email', :'admin_nombre', 'Administrador de la plataforma',
        crypt(:'admin_password', gen_salt('bf', 10)))
ON CONFLICT (email) DO NOTHING;

INSERT INTO usuario_equipo (usuario_id, equipo_id)
SELECT u.id, e.id
FROM usuarios u, equipos e
WHERE u.email = :'admin_email' AND e.codigo = 'administrador'
ON CONFLICT DO NOTHING;
