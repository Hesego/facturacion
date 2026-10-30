export { formatearCOP } from '@gastos/shared';

const ZONA = 'America/Bogota';
const fechaHora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const soloFecha = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric' });

export const formatearFechaHora = (iso: string) => fechaHora.format(new Date(iso));
export const formatearFecha = (iso: string) => soloFecha.format(new Date(iso.length === 10 ? `${iso}T12:00:00-05:00` : iso));

export function formatearTamano(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function textoAntiguedad(dias: number) {
  if (dias === 0) return 'Hoy';
  return dias === 1 ? '1 día hábil' : `${dias} días hábiles`;
}

/** NIT con puntos y dígito de verificación: 900.502.031-8 */
export function formatearNit(nit: string, dv?: number) {
  const conPuntos = nit.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dv === undefined ? conPuntos : `${conPuntos}-${dv}`;
}
