import { Check, X } from 'lucide-react';
import type { Detalle } from '../../api/tipos';
import { cx } from '../../componentes/ui';

/** Línea de etapas agrupadas (PG_ENV y PG_APR se ven como «PG» con sus dos pasos). */
export function ProgresoFlujo({ d }: { d: Detalle }) {
  const actual = d.flujo.find((e) => e.id === d.etapa.id);
  const grupos: { grupo: string; etapas: Detalle['flujo'] }[] = [];
  for (const e of d.flujo) {
    const g = grupos.find((x) => x.grupo === e.grupo);
    if (g) g.etapas.push(e); else grupos.push({ grupo: e.grupo, etapas: [e] });
  }
  const pagada = d.transaccion.estado === 'pagada';
  const anulada = d.transaccion.estado === 'anulada';

  return (
    <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Avance del flujo">
      {grupos.map(({ grupo, etapas }) => {
        const contieneActual = etapas.some((e) => e.id === actual?.id);
        const hecho = pagada || (!!actual && Math.max(...etapas.map((e) => e.orden)) < actual.orden);
        const estado = anulada && contieneActual ? 'anulada' : contieneActual && !pagada ? 'actual' : hecho ? 'hecho' : 'pendiente';
        const sub = contieneActual && etapas.length > 1 ? actual!.nombre : etapas.length === 1 ? etapas[0]!.nombre : etapas.map((e) => e.nombre).join(' · ');
        return (
          <li key={grupo} className="min-w-[92px] flex-1" aria-current={estado === 'actual' ? 'step' : undefined}>
            <div className={cx('h-1.5 rounded-full',
              estado === 'hecho' && 'bg-teal-profundo', estado === 'actual' && 'bg-regla', estado === 'pendiente' && 'bg-linea', estado === 'anulada' && 'bg-rojo')} />
            <div className="mt-2.5 flex items-center gap-1.5">
              <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                estado === 'hecho' && 'bg-teal-profundo text-white', estado === 'actual' && 'bg-naranja-profundo text-white',
                estado === 'pendiente' && 'border-[1.5px] border-linea bg-white', estado === 'anulada' && 'bg-rojo text-white')}>
                {estado === 'hecho' && <Check className="h-3 w-3" strokeWidth={3} />}
                {estado === 'anulada' && <X className="h-3 w-3" strokeWidth={3} />}
                {estado === 'actual' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className={cx('font-titular text-[16px] uppercase leading-none', estado === 'pendiente' ? 'text-meta' : 'text-tinta')}>{grupo}</span>
            </div>
            <p className={cx('mt-1 text-[12px] leading-tight', estado === 'actual' ? 'font-bold text-tinta' : 'text-meta')}>{sub}</p>
          </li>
        );
      })}
    </ol>
  );
}
