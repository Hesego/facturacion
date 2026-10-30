/** Códigos de error de negocio que devuelve la API (campo `codigo` de la respuesta). */
export const CODIGOS_ERROR = {
  NO_AUTENTICADO: 401,
  SIN_PERMISO: 403,
  SEGREGACION: 403,
  NO_ENCONTRADA: 404,
  TRANSACCION_CERRADA: 409,
  VERSION_DESACTUALIZADA: 409,
  DEVOLUCION_NO_PERMITIDA: 409,
  FACTURA_DUPLICADA: 409,
  REFERENCIA_DUPLICADA: 409,
  DATOS_INVALIDOS: 422,
  REQUISITOS_INCOMPLETOS: 422,
  ARCHIVO_INVALIDO: 422,
  DEMASIADOS_INTENTOS: 429,
  CONFIGURACION_INVALIDA: 500,
} as const;

export type CodigoError = keyof typeof CODIGOS_ERROR;

export interface RespuestaError {
  codigo: CodigoError | 'ERROR_INTERNO';
  mensaje: string;
  detalles?: unknown;
}

/** Un requisito de la etapa y si ya se cumple (lista de verificación del detalle). */
export interface ItemRequisito {
  clave: string;
  descripcion: string;
  cumple: boolean;
  detalle?: string;
}
