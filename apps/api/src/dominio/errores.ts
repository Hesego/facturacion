import { CODIGOS_ERROR, type CodigoError } from '@gastos/shared';

/** Error esperado de negocio: se responde al usuario con su código y un mensaje claro. */
export class ErrorNegocio extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorNegocio';
  }

  get status(): number {
    return CODIGOS_ERROR[this.codigo];
  }
}

/** Violación de un índice único de Postgres, con el nombre de la restricción. */
export function violacionUnica(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string };
  return err?.code === '23505' ? (err.constraint ?? '') : null;
}
