import type { CodigoError, ItemRequisito, RespuestaError } from '@gastos/shared';

/** Error devuelto por la API, con su código de negocio y un mensaje listo para mostrar. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: CodigoError | 'ERROR_INTERNO' | 'SIN_CONEXION',
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
  }

  /** Lista de requisitos faltantes cuando el código es REQUISITOS_INCOMPLETOS. */
  get faltantes(): ItemRequisito[] {
    return this.codigo === 'REQUISITOS_INCOMPLETOS' && Array.isArray(this.detalles) ? (this.detalles as ItemRequisito[]) : [];
  }
}

async function solicitar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${ruta}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: cuerpo instanceof FormData || cuerpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: cuerpo instanceof FormData ? cuerpo : cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'SIN_CONEXION', 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.');
  }
  if (r.ok) return (r.status === 204 ? undefined : await r.json()) as T;
  const e = (await r.json().catch(() => null)) as RespuestaError | null;
  throw new ErrorApi(r.status, e?.codigo ?? 'ERROR_INTERNO', e?.mensaje ?? 'Ocurrió un error inesperado.', e?.detalles);
}

export const api = {
  get: <T>(ruta: string) => solicitar<T>('GET', ruta),
  post: <T>(ruta: string, cuerpo?: unknown) => solicitar<T>('POST', ruta, cuerpo ?? {}),
  put: <T>(ruta: string, cuerpo: unknown) => solicitar<T>('PUT', ruta, cuerpo),
  patch: <T>(ruta: string, cuerpo: unknown) => solicitar<T>('PATCH', ruta, cuerpo),
  /** Multipart: campos y archivos, cada archivo con el nombre de campo en que debe llegar (p. ej. factura_0, soporte). */
  formulario: <T>(ruta: string, campos: Record<string, string | number | undefined>, archivos: [string, File][] = []) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== '') f.append(k, String(v));
    for (const [campo, a] of archivos) f.append(campo, a, a.name);
    return solicitar<T>('POST', ruta, f);
  },
};
