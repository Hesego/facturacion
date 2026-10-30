import { useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Table2, BarChart3 } from 'lucide-react';
import { api } from '../api/cliente';
import type { Semaforo as TSemaforo, Tablero as TTablero } from '../api/tipos';
import { ChipEtapa, SEMAFORO } from '../componentes/marca';
import { Alerta, Cargando, Cifra, cx, EncabezadoPagina, Tarjeta, Vacio } from '../componentes/ui';
import { formatearCOP } from '../formato';
import { FilaTransaccion } from './Pendientes';

const ORDEN_SEMAFORO: TSemaforo[] = ['verde', 'amarillo', 'naranja', 'rojo'];
const dias = (n: number) => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })} ${n === 1 ? 'día' : 'días'}`;

/** Detalle flotante al pasar el cursor por una barra. */
function useTooltip() {
  const [t, setT] = useState<{ x: number; y: number; contenido: ReactNode } | null>(null);
  const mostrar = (contenido: ReactNode) => (e: MouseEvent<HTMLElement>) => {
    const caja = (e.currentTarget.closest('[data-grafica]') as HTMLElement).getBoundingClientRect();
    setT({ x: e.clientX - caja.left, y: e.clientY - caja.top, contenido });
  };
  const nodo = t && (
    <div role="tooltip" className="pointer-events-none absolute z-20 w-max max-w-[260px] -translate-x-1/2 -translate-y-full rounded-xl border border-linea bg-white px-3.5 py-2.5 text-[14px] shadow-flotante"
      style={{ left: t.x, top: t.y - 12 }}>{t.contenido}</div>
  );
  return { mostrar, ocultar: () => setT(null), nodo };
}

function Alternar({ tabla, setTabla }: { tabla: boolean; setTabla: (v: boolean) => void }) {
  return (
    <button onClick={() => setTabla(!tabla)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-bold text-teal-profundo hover:bg-teal-profundo/10">
      {tabla ? <><BarChart3 className="h-4 w-4" strokeWidth={2} /> Ver gráfica</> : <><Table2 className="h-4 w-4" strokeWidth={2} /> Ver tabla</>}
    </button>
  );
}

const th = 'px-2 pb-2 text-left font-etiqueta text-[12px] font-bold uppercase tracking-chip text-meta';
const td = 'px-2 py-2 border-t border-linea';

/** Barras apiladas por estado del semáforo: cuántos gastos hay en cada etapa y qué tan atrasados. */
function PorEtapa({ etapas }: { etapas: TTablero['etapas'] }) {
  const [tabla, setTabla] = useState(false);
  const tip = useTooltip();
  const max = Math.max(1, ...etapas.map((e) => e.en_curso));
  return (
    <Tarjeta kicker="En curso" titulo="Gastos por etapa" extra={<Alternar tabla={tabla} setTabla={setTabla} />}>
      {/* Leyenda: el color nunca va solo, siempre con su texto */}
      <ul className="mb-5 flex flex-wrap gap-x-5 gap-y-2" aria-label="Leyenda">
        {ORDEN_SEMAFORO.map((s) => (
          <li key={s} className="flex items-center gap-2 text-[14px] text-secundario">
            <span aria-hidden className={cx('h-3 w-3 rounded-[3px]', SEMAFORO[s].relleno)} />{SEMAFORO[s].etiqueta}
          </li>
        ))}
      </ul>
      {tabla ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead><tr><th className={th}>Etapa</th>{ORDEN_SEMAFORO.map((s) => <th key={s} className={cx(th, 'text-right')}>{SEMAFORO[s].etiqueta}</th>)}<th className={cx(th, 'text-right')}>Total</th><th className={cx(th, 'text-right')}>Valor</th></tr></thead>
            <tbody>{etapas.map((e) => (
              <tr key={e.id}><td className={td}><b>{e.codigo}</b> · {e.nombre}</td>{ORDEN_SEMAFORO.map((s) => <td key={s} className={cx(td, 'text-right tabular-nums')}>{e[s]}</td>)}
                <td className={cx(td, 'text-right font-bold tabular-nums')}>{e.en_curso}</td><td className={cx(td, 'text-right tabular-nums')}>{formatearCOP(e.valor)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div data-grafica className="relative space-y-2.5" onMouseLeave={tip.ocultar}>
          {etapas.map((e) => (
            <div key={e.id} className="grid grid-cols-[minmax(0,180px)_1fr_36px] items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <ChipEtapa codigo={e.codigo} />
                <span className="truncate text-[14px] text-secundario">{e.nombre}</span>
              </div>
              <div className="flex h-6 items-stretch gap-[2px]" style={{ width: `${(e.en_curso / max) * 100}%`, minWidth: e.en_curso ? 8 : 0 }}>
                {ORDEN_SEMAFORO.filter((s) => e[s] > 0).map((s, i, lista) => (
                  <div key={s} className={cx(SEMAFORO[s].relleno, i === lista.length - 1 && 'rounded-r-[4px]', 'transition-opacity hover:opacity-80')}
                    style={{ flexGrow: e[s] }}
                    onMouseMove={tip.mostrar(<><p className="font-bold">{e.codigo} · {e.nombre}</p><p className="text-secundario">{SEMAFORO[s].etiqueta}: <b className="text-tinta">{e[s]}</b> de {e.en_curso}</p></>)} />
                ))}
              </div>
              <span className="text-right font-bold tabular-nums">{e.en_curso}</span>
            </div>
          ))}
          {tip.nodo}
        </div>
      )}
    </Tarjeta>
  );
}

/** Tiempo promedio que pasan los gastos en cada etapa, frente a su plazo (SLA). */
function TiempoPorEtapa({ etapas }: { etapas: TTablero['etapas'] }) {
  const [tabla, setTabla] = useState(false);
  const tip = useTooltip();
  const max = Math.max(1, ...etapas.map((e) => Math.max(e.promedio_dias_habiles ?? 0, e.sla_dias)));
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <Tarjeta kicker="Últimos 180 días · días hábiles" titulo="Tiempo promedio por etapa" acento="naranja" extra={<Alternar tabla={tabla} setTabla={setTabla} />}>
      <p className="mb-5 flex items-center gap-2 text-[14px] text-secundario">
        <span aria-hidden className="inline-block h-4 w-0 border-l-2 border-dashed border-tinta" /> La línea marca el plazo (SLA) de cada etapa.
      </p>
      {tabla ? (
        <table className="w-full text-[15px]">
          <thead><tr><th className={th}>Etapa</th><th className={cx(th, 'text-right')}>Promedio</th><th className={cx(th, 'text-right')}>Plazo</th><th className={cx(th, 'text-right')}>Pasos medidos</th></tr></thead>
          <tbody>{etapas.map((e) => (
            <tr key={e.id}><td className={td}><b>{e.codigo}</b> · {e.nombre}</td>
              <td className={cx(td, 'text-right tabular-nums')}>{e.promedio_dias_habiles === null ? '—' : dias(e.promedio_dias_habiles)}</td>
              <td className={cx(td, 'text-right tabular-nums')}>{dias(e.sla_dias)}</td><td className={cx(td, 'text-right tabular-nums')}>{e.tramos}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div data-grafica className="relative space-y-2.5" onMouseLeave={tip.ocultar}>
          {etapas.map((e) => {
            const v = e.promedio_dias_habiles;
            const excede = v !== null && v > e.sla_dias;
            return (
              <div key={e.id} className="grid grid-cols-[minmax(0,180px)_1fr_96px] items-center gap-3">
                <div className="flex min-w-0 items-center gap-2"><ChipEtapa codigo={e.codigo} /><span className="truncate text-[14px] text-secundario">{e.nombre}</span></div>
                <div className="relative h-6"
                  onMouseMove={tip.mostrar(<><p className="font-bold">{e.codigo} · {e.nombre}</p>
                    <p className="text-secundario">Promedio: <b className="text-tinta">{v === null ? 'sin datos' : dias(v)}</b> · plazo {dias(e.sla_dias)}</p>
                    <p className="text-secundario">{e.tramos} paso(s) medidos{e.promedio_horas !== null ? ` · ${Math.round(e.promedio_horas)} h de calendario` : ''}</p></>)}>
                  {v !== null && <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-teal-profundo" style={{ width: pct(v), minWidth: v > 0 ? 3 : 0 }} />}
                  <div aria-hidden className="absolute -inset-y-1 w-0 border-l-2 border-dashed border-tinta" style={{ left: pct(e.sla_dias) }} />
                </div>
                <span className={cx('text-right text-[14px] tabular-nums', excede ? 'font-bold text-naranja-profundo' : 'text-tinta')}>
                  {v === null ? '—' : dias(v)}{excede && <span className="block text-[11px] font-bold uppercase tracking-chip">Sobre el plazo</span>}
                </span>
              </div>
            );
          })}
          {tip.nodo}
        </div>
      )}
    </Tarjeta>
  );
}

export function Tablero() {
  const { data: d, isLoading, error } = useQuery({ queryKey: ['tablero'], queryFn: () => api.get<TTablero>('/tablero'), refetchInterval: 120_000 });
  if (isLoading) return <Cargando />;
  if (error || !d) return <Alerta tono="error">{error?.message ?? 'No fue posible cargar el tablero'}</Alerta>;
  const t = d.totales;

  return (
    <>
      <EncabezadoPagina kicker="Indicadores del proceso" titulo={<>Tablero <span className="text-teal-profundo">general</span></>}>
        Dónde están los gastos, cuánto tardan en cada etapa y cuáles están atascados.
      </EncabezadoPagina>

      <div className="mb-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Cifra valor={t.en_curso} etiqueta="Gastos en curso" />
        <Cifra valor={t.vencidas} etiqueta="Vencidos" tono={t.vencidas ? 'naranja' : 'verde'} />
        <Cifra valor={t.pagadas_mes} etiqueta="Pagados este mes" tono="verde" />
        <Cifra valor={t.ciclo_dias_habiles === null ? '—' : t.ciclo_dias_habiles.toLocaleString('es-CO')} etiqueta="Días hábiles, solicitud a pago" tono="naranja" />
      </div>
      <p className="-mt-4 mb-8 text-[15px] text-secundario">
        En curso: <b className="text-tinta">{formatearCOP(t.valor_en_curso)}</b> · Pagado este mes: <b className="text-tinta">{formatearCOP(t.valor_pagado_mes)}</b>
        {t.anuladas_mes > 0 && <> · Anulados este mes: <b className="text-tinta">{t.anuladas_mes}</b></>}
      </p>

      <div className="grid gap-6 xl:grid-cols-2">
        <PorEtapa etapas={d.etapas} />
        <TiempoPorEtapa etapas={d.etapas} />
      </div>

      <Tarjeta kicker="En curso" titulo="Gastos por área" className="mt-6">
        {d.areas.length === 0 ? <p className="text-secundario">No hay gastos en curso.</p> : (
          <table className="w-full text-[15px]">
            <thead><tr><th className={th}>Área</th><th className={cx(th, 'text-right')}>En curso</th><th className={cx(th, 'text-right')}>Vencidos</th></tr></thead>
            <tbody>{d.areas.map((a) => (
              <tr key={a.area_id ?? 'sin'}>
                <td className={td}><b>{a.area}</b>{a.equipo && <span className="text-meta"> · {a.equipo}</span>}</td>
                <td className={cx(td, 'text-right font-bold tabular-nums')}>{a.en_curso}</td>
                <td className={cx(td, 'text-right tabular-nums', a.vencidas ? 'font-bold text-naranja-profundo' : 'text-meta')}>{a.vencidas}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Tarjeta>

      <Tarjeta kicker="Superaron el plazo de su etapa" titulo="Gastos atascados" acento="naranja" className="mt-6">
        {d.atascadas.length === 0 ? (
          <Vacio icono={<CheckCircle2 className="h-7 w-7" strokeWidth={2} />} titulo="Nada atascado">Todos los gastos están dentro del plazo de su etapa.</Vacio>
        ) : (
          <ul className="-mx-2 divide-y divide-linea sm:-mx-3">
            {d.atascadas.map((a) => <FilaTransaccion key={a.id} p={{ ...a, dias: a.dias_habiles_en_etapa }} />)}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}
