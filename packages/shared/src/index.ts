export * from './requisitos.js';
export * from './esquemas.js';
export * from './errores.js';
export * from './administracion.js';

const formatoCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** $ 1.500.000 */
export const formatearCOP = (valor: string | number) => formatoCOP.format(Number(valor));
