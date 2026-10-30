import { z } from 'zod';

const texto = (min: number, max: number, campo: string) =>
  z
    .string({ required_error: `${campo} es obligatorio` })
    .trim()
    .min(min, `${campo} debe tener al menos ${min} caracteres`)
    .max(max, `${campo} admite máximo ${max} caracteres`);

/** Texto opcional: vacío equivale a no enviarlo. */
const opcional = (max: number, campo: string) =>
  z.string().trim().max(max, `${campo} admite máximo ${max} caracteres`).optional().transform((v) => (v ? v : undefined));

/** Acepta 1.500.000 · 1500000,50 · $ 1.500.000 y lo deja como 1500000.50 */
export function normalizarValor(texto: string) {
  const limpio = texto.replace(/[$\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio) || /^\d+,\d{1,2}$/.test(limpio)) return limpio.replace(/\./g, '').replace(',', '.');
  return limpio;
}

/** Valor en pesos, opcional: número positivo con máximo dos decimales. Se maneja como texto para no perder precisión. */
export const valorCOP = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || String(v).trim() === '' ? undefined : normalizarValor(String(v))))
  .refine((v) => v === undefined || (/^\d{1,16}(\.\d{1,2})?$/.test(v) && Number(v) > 0), 'El valor debe ser un número mayor que cero');

export const idNumerico = z.coerce.number().int().positive();

export const credenciales = z.object({
  email: z.string().trim().toLowerCase().email('Escribe un correo válido'),
  password: z.string().min(1, 'Escribe tu contraseña'),
});

export const numeroFactura = texto(1, 40, 'El número de la factura');

/**
 * Campos de la solicitud. Las facturas van como archivos `factura_<i>` (PDF y opcional XML/ZIP)
 * con su número en `numero_<i>`; los soportes adicionales, como archivos `soporte`.
 */
/** Área del equipo destino (si el equipo tiene áreas). Vacío = sin área. */
const areaOpcional = z.union([idNumerico, z.literal('')]).optional().transform((v) => (v === '' ? undefined : v));

export const crearSolicitud = z.object({
  asignarA: idNumerico,
  areaId: areaOpcional,
  valor: valorCOP,
  descripcion: opcional(200, 'La descripción'),
  comentario: opcional(4000, 'El comentario'),
});
export type CrearSolicitud = z.infer<typeof crearSolicitud>;

/** Toda acción de flujo envía la versión que vio el usuario (bloqueo optimista). */
const version = z.coerce.number().int().positive();

/** Completar la etapa: número de su documento (si lo pide), comentario y a quién se envía. */
export const avanzar = z.object({
  version,
  asignarA: idNumerico.optional(),
  areaId: areaOpcional,
  numero: opcional(40, 'El número'),
  comentario: opcional(4000, 'El comentario'),
});

export const devolver = z.object({ version, motivo: texto(5, 4000, 'El motivo') });
export const anular = z.object({ version, motivo: texto(5, 4000, 'El motivo') });
export const reasignar = z.object({ version, usuarioId: idNumerico, areaId: areaOpcional, motivo: opcional(500, 'El motivo') });

export const registrarFactura = z.object({
  numero: numeroFactura.optional().or(z.literal('')).transform((v) => v || undefined),
});

export const inactivar = z.object({
  motivo: z.enum(['reemplazo', 'error_registro']),
});

export const comentar = z.object({
  texto: texto(1, 4000, 'El comentario'),
});

export const filtroTransacciones = z.object({
  estado: z.enum(['en_curso', 'pagada', 'anulada']).optional(),
  etapa: z.string().optional(),
  areaId: idNumerico.optional(),
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});
