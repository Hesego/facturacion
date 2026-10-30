# API

Todas las rutas van bajo `/api` y responden JSON. La sesión viaja en la cookie `gastos_sesion` (httpOnly, SameSite=Strict).

## Errores

Toda respuesta de error tiene la misma forma:

```json
{ "codigo": "REQUISITOS_INCOMPLETOS", "mensaje": "Para avanzar la etapa Requerimiento falta: …", "detalles": [ … ] }
```

| Código | HTTP | Cuándo |
|---|---|---|
| `NO_AUTENTICADO` | 401 | Sin sesión, sesión vencida o credenciales inválidas |
| `SIN_PERMISO` | 403 | La transacción no está asignada al usuario, o su equipo no puede hacer esa acción |
| `SEGREGACION` | 403 | Quien ejecutó la etapa anterior intenta aprobar (o enviarse) la siguiente |
| `NO_ENCONTRADA` | 404 | La transacción, factura o adjunto no existe |
| `TRANSACCION_CERRADA` | 409 | La transacción está pagada o anulada |
| `VERSION_DESACTUALIZADA` | 409 | Otra persona la cambió desde que la cargaste: recargar |
| `DEVOLUCION_NO_PERMITIDA` | 409 | La etapa no tiene etapa de devolución configurada |
| `FACTURA_DUPLICADA` | 409 | Mismo CUFE, mismo PDF o mismo número de factura en otra factura activa |
| `REFERENCIA_DUPLICADA` | 409 | El número de RQ, OC, ES o CP ya existe en otra transacción |
| `DATOS_INVALIDOS` | 422 | Validación de campos (los detalles traen `campo` y `mensaje`) |
| `REQUISITOS_INCOMPLETOS` | 422 | Faltan requisitos de la etapa; `detalles` es la lista de lo que falta |
| `ARCHIVO_INVALIDO` | 422 | Vacío, muy grande, tipo no permitido o contenido que no coincide |
| `DEMASIADOS_INTENTOS` | 429 | Más de 10 intentos de login por minuto |

## Rutas

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/login` | Todos | `{ email, password }` → crea la sesión |
| `POST /auth/logout` | Con sesión | Cierra la sesión |
| `GET /auth/yo` | Con sesión | Usuario y sus equipos |
| `GET /catalogos` | Con sesión | Etapas activas y, para cada una, las personas a las que se les puede enviar |
| `GET /pendientes` | Con sesión | Transacciones asignadas al usuario, con días hábiles y semáforo |
| `GET /transacciones?estado&etapa&q&pagina&porPagina` | Con sesión | Listado con búsqueda por consecutivo, factura, RQ/OC/ES, descripción, proveedor o persona a cargo |
| `POST /transacciones` | Contabilidad | Multipart: una o varias facturas como archivos `factura_<i>` (PDF y opcional XML/ZIP DIAN) con su número en `numero_<i>` (opcional si va el XML); soportes como archivos `soporte`; y `asignarA`, `valor?`, `descripcion?`, `comentario?`. Crea y envía a la siguiente etapa |
| `GET /transacciones/:id` | Con sesión | Detalle: datos, flujo, requisitos, acciones (con destinatarios posibles y a quién vuelve una devolución), facturas, adjuntos, números, historial y comentarios |
| `POST /transacciones/:id/avanzar` | Persona asignada | JSON o multipart: `version`, `asignarA`, `numero?`, `comentario?`, los documentos de la etapa (archivos `documento`, uno o varios) y soportes (`soporte`). En aprobaciones es **Aprobar** |
| `POST /transacciones/:id/devolver` | Persona asignada | `{ version, motivo }`. Vuelve a quien había completado esa etapa. En aprobaciones es **Rechazar** |
| `POST /transacciones/:id/reasignar` | Asignada, contabilidad o administrador | `{ version, usuarioId, motivo? }` a otro miembro del mismo equipo |
| `POST /transacciones/:id/anular` | Contabilidad o administrador | `{ version, motivo }` |
| `POST /transacciones/:id/facturas` | Contabilidad | Multipart: una o varias facturas, con los mismos campos `factura_<i>` y `numero_<i>` |
| `POST /transacciones/:id/adjuntos` | Persona asignada o contabilidad | Multipart: uno o varios soportes adicionales |
| `POST /transacciones/:id/comentarios` | Con sesión | `{ texto }` |
| `POST /adjuntos/:id/inactivar` | Persona asignada | `{ motivo: reemplazo\|error_registro }` |
| `POST /facturas/:id/inactivar` | Contabilidad | `{ motivo: reemplazo\|error_registro }` |
| `GET /adjuntos/:id/descarga` | Con sesión | Descarga el archivo desde S3 |
| `GET /tablero` | Con sesión | Cifras, gastos por etapa, tiempos promedio y atascados |
| `/admin/usuarios`, `/admin/equipos`, `/admin/etapas`, `/admin/etapas/orden`, `/admin/configuracion` | Administrador | Administración |
| `GET /salud` | Todos | Verifica la conexión a la base de datos |

**Multipart:** hasta 20 archivos por envío. Una factura repetida dentro de la misma tanda se rechaza (`FACTURA_DUPLICADA`, criterio `tanda`).

**Versión:** toda acción del flujo envía la `version` que el usuario vio. Si dos personas actúan a la vez, solo una lo logra; la otra recibe `VERSION_DESACTUALIZADA`.
