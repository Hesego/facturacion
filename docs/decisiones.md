# Decisiones de diseño

Registro de lo acordado antes de construir. Si una decisión cambia, se actualiza aquí con la fecha.

## Acordadas el 2026-10-29

| # | Tema | Decisión |
|---|---|---|
| 1 | Rechazar en etapas de aprobación (AP, AG, PG_APR) | «Rechazar» devuelve la transacción a la etapa anterior con motivo obligatorio. No hay rechazo definitivo: para terminar un trámite, contabilidad o administrador lo **anulan**. |
| 2 | Quién aprueba AP | Solo el **líder aprobador del área** asignada a la transacción, que además debe pertenecer al equipo `lider_operaciones`. |
| 2b | Áreas = equipos de operaciones | Operaciones se divide en varios equipos (SST, TICS, Inventario…). Se modelan como `areas`, administrables y sin lista fija. Un usuario de operaciones solo actúa sobre transacciones de las áreas a las que pertenece (`usuario_area`). |
| 2c | Escalamiento de SLA | Etapa restringida a miembros del área → líder del área. Etapa del líder del área o sin restricción → líder del equipo responsable (`equipos.lider_usuario_id`). |
| 3 | Facturas de transacciones anuladas | Se **liberan**: dejan de contar para la regla de duplicados y pueden registrarse en otra transacción. Lo mismo aplica a los números de RQ, OC, ES y comprobante. |
| 4 | Facturas frente al valor | La suma de las facturas activas debe ser **igual** al valor del gasto. Se exige para enviar (PG_ENV) y aprobar (PG_APR) el pago. Cada factura debe ser del mismo NIT del proveedor de la transacción. |
| 5 | «ES consolidada» | No es un documento: PG_ENV es la notificación a gerencia financiera para aprobar el pago, acompañada de todos los soportes ya cargados (facturas, RQ, OC, ES). |
| 6 | SLA | Se cuenta en **días hábiles** (lunes a viernes, sin festivos de Colombia). Semáforo: mismo día = verde, 1 día = amarillo, 2 días = naranja, 3 o más = rojo (vencida). Los umbrales son configurables. |
| 7 | Correo y acceso | Producción con **Gmail** (SMTP `smtp.gmail.com:587`, contraseña de aplicación); cada correo muestra a quien hizo el paso y le dirige las respuestas (Reply-To). El asunto es el que escribe el solicitante. El esquema de usuarios queda listo para iniciar sesión con Microsoft (Entra ID) más adelante. |
| 8 | Activos de marca | Aún no hay archivos maestros. El código define las rutas esperadas en `brand/` y usa un marcador de texto mientras tanto. **Nunca se redibuja el logo** (Manual de Marca v1.1, lámina 9). |
| 9 | Moneda | Solo pesos colombianos (COP). |
| 10 | Trazabilidad entre actores | Toda etapa que ejecuta una persona exige una **observación** al completarla (antes solo las aprobaciones). La persona que recibe la ve destacada al abrir la tarea y en su bandeja, y el correo la trae arriba con el historial de observaciones anteriores debajo (quién, etapa, fecha). |

## Propuestas aplicadas por defecto (sin objeción)

- **PG en dos subetapas:** `PG_ENV` (contabilidad envía) y `PG_APR` (gerencia financiera aprueba), agrupadas como «PG» en la interfaz. Cada fila del catálogo tiene un solo responsable, su propio SLA y su devolución, y la segregación de funciones sale de forma natural.
- **Consecutivo:** `GTO-AAAA-000001`, reinicia cada año. El prefijo es configurable.
- **Números de RQ, OC, ES y comprobante:** únicos en todo el sistema por tipo, con una referencia activa por tipo en cada transacción.
- **Segregación:** aplica a las etapas marcadas `segregacion = true` (AP, AG y PG_APR). El usuario que llevó la transacción a la etapa no puede aprobarla.
- **Contraseñas:** bcrypt (compatible con `pgcrypto` para las semillas).

## Ajustes durante la construcción

- **Fase 5 · Colores del semáforo:** al validar la paleta para daltonismo, el naranja vivo y el ámbar resultaron indistinguibles entre sí. El semáforo usa verde `#12A594`, ámbar `#E0A00E`, naranja profundo `#B45309` (de la paleta del manual) y rojo oscuro `#7F1D1D` para «vencida». El mismo juego se usa en las píldoras y en las gráficas, y siempre va acompañado de texto.
- **Fase 5 · Tablero:** lo ven todos los usuarios con sesión, por transparencia del proceso. La administración es solo del equipo `administrador`.

## Simplificación (2026-10-29): control, no proceso contable

La plataforma es de **control y seguimiento**: los datos contables (proveedor, NIT, CUFE…) viven en otra plataforma. Esta decisión **reemplaza** a las decisiones 2, 2b, 2c, 4 y 5 de arriba.

| Tema | Decisión |
|---|---|
| Solicitud | Solo la factura (PDF y, si lo hay, el ZIP/XML de la DIAN), su número y a quién se envía. Valor, descripción corta y comentario son opcionales. Se crea y se envía en un solo paso. |
| Etapas siguientes | Cada una: número de su documento (RQ, OC, ES, comprobante) + el documento + a quién se envía. Las aprobaciones: comentario + a quién se envía. Todo en un solo formulario. |
| Asignación | La transacción queda asignada a **una persona**, elegida por quien envía entre los miembros del equipo de la etapa siguiente. Solo esa persona la ve en sus pendientes y puede actuar. Desaparecen las áreas. |
| Devolución | Regresa automáticamente a quien había completado la etapa a la que vuelve. |
| Reasignación | Para vacaciones o ausencias: la persona asignada, contabilidad o el administrador la pasan a otro miembro del mismo equipo. El plazo (SLA) no se reinicia. Queda auditada y se notifica. |
| Factura electrónica | Si adjuntan el XML o el ZIP de la DIAN, el número, el CUFE, el NIT, el proveedor, la fecha y el valor se **leen solos** (solo para validar y mostrar). Del ZIP también se saca el PDF. |
| Duplicados | Mismo CUFE, mismo PDF, o mismo número de factura (salvo que ambas traigan el XML con NIT distinto: son de proveedores diferentes). |
| Escalamiento de SLA | Al líder del equipo de la etapa vencida. |
| Proveedores y áreas | Se eliminaron del modelo (migración 9). |
| Varios archivos | Una solicitud puede llevar varias facturas (cada una con su número y, si lo hay, su XML/ZIP) y soportes adicionales (pantallazos, fotos, PDF). Cada etapa acepta varios documentos y soportes. Sin valor escrito, el valor del gasto es la suma de los XML. |
| Áreas dentro de los equipos (2026-10-30) | Cada equipo puede tener áreas (p. ej. Operaciones y Líderes de operaciones → SST, TICS, Inventario). Al enviar a una etapa cuyo equipo tiene áreas, se elige el área y luego aparece la lista de personas de esa área. Si el equipo no tiene áreas, se elige directo la persona. El área queda registrada en la transacción y en el historial, y se puede filtrar y contar por área (listado y tablero). Una devolución vuelve al área en que estuvo; al reasignar, se toma el área de la nueva persona. |
| Avisos solo al destinatario (2026-11-05) | Cada correo le llega **solo a la persona a la que va dirigido el paso**: a quien se le envía, devuelve o reasigna la transacción. Ya no se avisa a contabilidad ni al solicitante en cada cambio (era ruido). Anulación: solo a quien la tenía pendiente. Cierre (pagada): solo al solicitante. El recordatorio de SLA vencido sigue igual (la persona y, si toca, su líder). Se eliminó la configuración «Quién recibe el seguimiento» (migración 20261105000100). |
