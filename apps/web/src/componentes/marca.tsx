import { useState } from 'react';
import type { Semaforo as TSemaforo } from '../api/tipos';
import { textoAntiguedad } from '../formato';
import { MARCA } from '../marca';
import { cx } from './ui';

/**
 * Logo cuadrado desde el archivo maestro. Prueba SVG y luego PNG; si no hay archivo, muestra un
 * marcador de texto (nunca una imitación del logotipo). Alto mínimo en pantalla: 80 px (lámina 6).
 */
export function Logo({ variante, alto = 80 }: { variante: 'color' | 'blanco'; alto?: number }) {
  const fuentes = MARCA.logo[variante];
  const [intento, setIntento] = useState(0);
  if (intento < fuentes.length) {
    return <img src={fuentes[intento]} alt={MARCA.nombre} style={{ height: Math.max(alto, 80) }} className="w-auto self-start" onError={() => setIntento((i) => i + 1)} />;
  }
  return (
    <div title="Logo pendiente: ubique el archivo maestro en brand/ (ver brand/README.md)"
      className={cx('inline-flex flex-col justify-center self-start rounded-lg border border-dashed px-3 py-2 font-etiqueta uppercase',
        variante === 'blanco' ? 'border-white/30 text-white' : 'border-linea text-tinta')}>
      <span className="text-[20px] font-bold leading-none tracking-[0.22em]">Hesego</span>
      <span className={cx('mt-1 text-[11px] font-semibold tracking-chip', variante === 'blanco' ? 'text-navy-suave' : 'text-meta')}>Ingeniería S.A.S.</span>
    </div>
  );
}

export const SEMAFORO: Record<TSemaforo, { punto: string; relleno: string; etiqueta: string }> = {
  verde: { punto: 'bg-semaforo-verde', relleno: 'bg-semaforo-verde', etiqueta: 'A tiempo' },
  amarillo: { punto: 'bg-semaforo-amarillo', relleno: 'bg-semaforo-amarillo', etiqueta: 'Atención' },
  naranja: { punto: 'bg-semaforo-naranja', relleno: 'bg-semaforo-naranja', etiqueta: 'Por vencer' },
  rojo: { punto: 'bg-white', relleno: 'bg-semaforo-rojo', etiqueta: 'Vencida' },
};

/**
 * Semáforo de SLA en días hábiles (decisión 6): mismo día verde, 1 día amarillo, 2 naranja, 3+ rojo.
 * El color va en el punto y el texto en tinta (el ámbar y el naranja vivo no sirven como texto);
 * el rojo se rellena para que destaque.
 */
export function Semaforo({ semaforo, dias, compacto }: { semaforo: TSemaforo; dias: number; compacto?: boolean }) {
  const s = SEMAFORO[semaforo];
  const rojo = semaforo === 'rojo';
  return (
    <span className={cx('inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 font-etiqueta text-[13px] font-bold uppercase leading-none tracking-chip',
      rojo ? 'bg-semaforo-rojo text-white' : 'border-[1.5px] border-linea bg-white text-tinta')}
      title={`${s.etiqueta}: ${textoAntiguedad(dias)} en la etapa`}>
      <span aria-hidden className={cx('h-2.5 w-2.5 rounded-full', s.punto)} />
      {compacto ? textoAntiguedad(dias) : `${s.etiqueta} · ${textoAntiguedad(dias)}`}
    </span>
  );
}

/** Código de etapa como el cuadrado numerado de los encabezados de capítulo (lámina 14). */
export function ChipEtapa({ codigo, tamano = 'normal', tono = 'teal' }: { codigo: string; tamano?: 'normal' | 'grande'; tono?: 'teal' | 'naranja' | 'gris' }) {
  const [grupo, sub] = codigo.split('_');
  return (
    <span className={cx('inline-flex shrink-0 flex-col items-center justify-center rounded-xl font-titular uppercase leading-none text-white',
      tono === 'teal' && 'bg-chip-teal', tono === 'naranja' && 'bg-chip-naranja', tono === 'gris' && 'bg-meta',
      tamano === 'grande' ? 'h-[62px] min-w-[62px] px-2 text-[24px]' : 'h-10 min-w-10 px-1.5 text-[15px]')}>
      {grupo}
      {sub && <span className={cx('mt-0.5 font-etiqueta font-bold tracking-chip', tamano === 'grande' ? 'text-[11px]' : 'text-[8px]')}>{sub}</span>}
    </span>
  );
}
