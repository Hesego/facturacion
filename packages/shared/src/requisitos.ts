import { z } from 'zod';

export const TIPOS_REFERENCIA = ['RQ', 'OC', 'ES', 'CP'] as const;
export const tipoReferencia = z.enum(TIPOS_REFERENCIA);
export type TipoReferencia = z.infer<typeof tipoReferencia>;

const codigoTipo = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use minúsculas, números y guion bajo');

/**
 * Contenido de `catalogo_etapas.requisitos`: lo que una etapa exige para poder avanzar.
 * Es la única fuente de las validaciones por etapa; agregar una etapa no requiere código.
 */
export const requisitosEtapa = z
  .object({
    /** Número que se registra en esta etapa (RQ, OC, ES, CP). */
    referencias: z.array(z.object({ tipo: tipoReferencia, etiqueta: z.string().min(1) })).default([]),
    /** Números que ya deben existir, registrados en etapas anteriores. */
    referencias_previas: z.array(tipoReferencia).default([]),
    /** Archivos que se cargan en esta etapa, con su cantidad mínima. */
    adjuntos: z
      .array(z.object({ tipo: codigoTipo, etiqueta: z.string().min(1), min: z.number().int().min(0).default(1) }))
      .default([]),
    /** Facturas activas que debe tener la transacción. */
    facturas: z.object({ min: z.number().int().min(0).default(0) }).optional(),
    /** Exige un comentario al avanzar (en etapas de aprobación es el comentario de la decisión). */
    comentario_obligatorio: z.boolean().default(false),
  })
  .strict();

export type RequisitosEtapa = z.infer<typeof requisitosEtapa>;

/** Tipo de adjunto disponible en cualquier etapa para soportes que no encajan en otro tipo. */
export const ADJUNTO_SOPORTE_ADICIONAL = 'soporte_adicional';
/** PDF de una factura. */
export const ADJUNTO_FACTURA = 'factura';
/** XML (o ZIP) de la factura electrónica DIAN, opcional. */
export const ADJUNTO_FACTURA_XML = 'factura_xml';
