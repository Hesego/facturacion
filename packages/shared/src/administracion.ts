import { z } from 'zod';
import { requisitosEtapa } from './requisitos.js';

const nombre = (campo: string) => z.string().trim().min(2, `${campo} debe tener al menos 2 caracteres`).max(120);
const opcional = z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null));
const idONulo = z.coerce.number().int().positive().nullable();

export const clave = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(200)
  .refine((v) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(v) && /\d/.test(v), 'La contraseña debe combinar letras y números');

export const usuarioNuevo = z.object({
  email: z.string().trim().toLowerCase().email('Escribe un correo válido'),
  nombre: nombre('El nombre'),
  cargo: opcional,
  password: clave,
  equipos: z.array(z.string()).default([]),
  areas: z.array(z.coerce.number().int().positive()).default([]),
});

export const usuarioCambios = z.object({
  nombre: nombre('El nombre').optional(),
  cargo: opcional,
  activo: z.boolean().optional(),
  equipos: z.array(z.string()).optional(),
  areas: z.array(z.coerce.number().int().positive()).optional(),
  password: clave.optional(),
});

export const equipoDatos = z.object({
  codigo: z.string().trim().regex(/^[a-z][a-z_]*$/, 'El código usa minúsculas y guion bajo, p. ej. gerencia_financiera'),
  nombre: nombre('El nombre'),
  descripcion: opcional,
  liderUsuarioId: idONulo.default(null),
  activo: z.boolean().default(true),
});

/** Área dentro de un equipo (p. ej. Operaciones → SST). */
export const areaDatos = z.object({
  equipoId: z.coerce.number().int().positive(),
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*$/, 'El código usa mayúsculas, números y guion bajo, p. ej. SST'),
  nombre: nombre('El nombre'),
  activa: z.boolean().default(true),
});

export const etapaDatos = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'El código usa mayúsculas, p. ej. VB o PG_ENV'),
  nombre: nombre('El nombre'),
  descripcion: opcional,
  grupo: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'El grupo usa mayúsculas, p. ej. PG'),
  orden: z.coerce.number().int().positive(),
  tipo: z.enum(['ejecucion', 'aprobacion', 'sistema']),
  equipoId: idONulo,
  slaDias: z.coerce.number().int().min(1).max(60),
  etapaDevolucionId: idONulo,
  segregacion: z.boolean().default(false),
  requisitos: requisitosEtapa,
  activa: z.boolean().default(true),
});

export const ordenEtapas = z.object({ ids: z.array(z.coerce.number().int().positive()).min(2) });

/** Claves de `configuracion` editables desde la administración, con su validación. */
const equipos = z.array(z.string().regex(/^[a-z][a-z_]*$/)).min(1, 'Indica al menos un equipo');
export const CONFIG_EDITABLE = {
  semaforo: z.object({ amarillo: z.number().int().min(0), naranja: z.number().int().min(1) })
    .refine((v) => v.naranja > v.amarillo, 'El umbral naranja debe ser mayor que el amarillo'),
  escalamiento_dias_despues_de_vencer: z.number().int().min(0).max(30),
  consecutivo_prefijo: z.string().regex(/^[A-Z]{2,6}$/, 'De 2 a 6 letras mayúsculas'),
  adjuntos_tamano_max_mb: z.number().int().min(1).max(25),
  equipos_pueden_anular: equipos,
  equipos_gestionan_facturas: equipos,
  equipos_pueden_reasignar: equipos,
  equipos_seguimiento: equipos,
} as const;
export type ClaveConfigEditable = keyof typeof CONFIG_EDITABLE;
