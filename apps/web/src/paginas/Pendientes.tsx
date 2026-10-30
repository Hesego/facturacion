import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronRight, MessageSquare } from 'lucide-react';
import { usePendientes, useYo } from '../api/consultas';
import type { Pendiente, Semaforo as TSemaforo } from '../api/tipos';
import { ChipEtapa, Semaforo } from '../componentes/marca';
import { Alerta, Cargando, Cifra, cx, EncabezadoPagina, Tarjeta, Vacio } from '../componentes/ui';
import { formatearCOP } from '../formato';

const FILTROS: { clave: 'todas' | TSemaforo | 'por_vencer'; etiqueta: string; incluye: (p: Pendiente) => boolean }[] = [
  { clave: 'todas', etiqueta: 'Todas', incluye: () => true },
  { clave: 'rojo', etiqueta: 'Vencidas', incluye: (p) => p.semaforo === 'rojo' },
  { clave: 'por_vencer', etiqueta: 'Por vencer', incluye: (p) => p.semaforo === 'naranja' || p.semaforo === 'amarillo' },
  { clave: 'verde', etiqueta: 'A tiempo', incluye: (p) => p.semaforo === 'verde' },
];

export function FilaTransaccion({ p }: { p: Pick<Pendiente, 'id' | 'consecutivo' | 'descripcion' | 'facturas' | 'asignado_nombre' | 'area_nombre' | 'valor' | 'etapa_codigo' | 'etapa_nombre' | 'ultima_observacion' | 'ultima_observacion_de'> & { semaforo?: TSemaforo | null; dias?: number | null; estado?: string } }) {
  const cerrada = p.estado && p.estado !== 'en_curso';
  const detalle = [p.facturas && `Factura ${p.facturas}`, !cerrada && p.asignado_nombre && `a cargo de ${p.asignado_nombre}${p.area_nombre ? ` (${p.area_nombre})` : ''}`].filter(Boolean).join(' · ');
  return (
    <li>
      <Link to={`/transacciones/${p.id}`}
        className="group flex items-center gap-4 rounded-xl px-3 py-4 transition-colors hover:bg-papel focus-visible:bg-papel sm:px-4">
        <ChipEtapa codigo={p.etapa_codigo} tono={cerrada ? 'gris' : 'teal'} />
        <div className="min-w-0 flex-1">
          <p className="font-etiqueta text-[13px] font-bold uppercase tracking-chip text-teal-profundo">
            {p.consecutivo} <span className="text-meta">· {p.etapa_nombre}</span>
          </p>
          <p className="mt-0.5 truncate font-bold text-tinta">{p.descripcion ?? (p.facturas ? `Factura ${p.facturas}` : 'Sin descripción')}</p>
          {detalle && <p className="truncate text-[14px] text-meta">{detalle}</p>}
          {p.ultima_observacion && (
            <p className="mt-1 truncate text-[14px] text-secundario">
              <MessageSquare className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-teal-profundo" strokeWidth={2} />
              <b className="text-tinta">{p.ultima_observacion_de}:</b> {p.ultima_observacion}
            </p>
          )}
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          {p.valor && <p className="font-bold tabular-nums text-tinta">{formatearCOP(p.valor)}</p>}
          {p.semaforo && p.dias != null && <Semaforo semaforo={p.semaforo} dias={p.dias} compacto />}
          {p.estado === 'pagada' && <span className="font-etiqueta text-[13px] font-bold uppercase tracking-chip text-verde">Pagada</span>}
          {p.estado === 'anulada' && <span className="font-etiqueta text-[13px] font-bold uppercase tracking-chip text-rojo">Anulada</span>}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-meta transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
      </Link>
    </li>
  );
}

export function Pendientes() {
  const { data: yo } = useYo();
  const { data, isLoading, error } = usePendientes();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['clave']>('todas');

  const resumen = useMemo(() => {
    const lista = data ?? [];
    return {
      total: lista.length,
      vencidas: lista.filter((p) => p.vencida).length,
      valor: lista.reduce((s, p) => s + Number(p.valor ?? 0), 0),
    };
  }, [data]);
  const visibles = (data ?? []).filter(FILTROS.find((f) => f.clave === filtro)!.incluye);

  return (
    <>
      <EncabezadoPagina kicker="Bandeja de trabajo" titulo={<>Tus <span className="text-teal-profundo">pendientes</span></>}>
        Hola, {yo?.nombre.split(' ')[0]}. Estas son las transacciones que tienes a tu cargo, de la más antigua a la más reciente.
      </EncabezadoPagina>

      {isLoading ? <Cargando /> : error ? <Alerta tono="error">{error.message}</Alerta> : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Cifra valor={resumen.total} etiqueta="Pendientes" />
            <Cifra valor={resumen.vencidas} etiqueta="Vencidas" tono={resumen.vencidas ? 'naranja' : 'verde'} />
            <div className="col-span-2 sm:col-span-1">
              <Cifra valor={<span className="text-[36px] sm:text-[44px]">{formatearCOP(resumen.valor)}</span>} etiqueta="Valor en tus manos" tono="tinta" />
            </div>
          </div>

          <Tarjeta acento={resumen.vencidas ? 'naranja' : 'teal'}>
            {resumen.total === 0 ? (
              <Vacio icono={<CheckCircle2 className="h-7 w-7" strokeWidth={2} />} titulo="Estás al día">
                No tienes transacciones pendientes. Te avisaremos por correo cuando llegue una nueva.
              </Vacio>
            ) : (
              <>
                <div className="-mx-1 mb-2 flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado del SLA">
                  {FILTROS.map((f) => {
                    const n = (data ?? []).filter(f.incluye).length;
                    return (
                      <button key={f.clave} onClick={() => setFiltro(f.clave)} aria-pressed={filtro === f.clave}
                        className={cx('rounded-full px-3.5 py-1.5 font-etiqueta text-[13px] font-bold uppercase tracking-chip transition-colors',
                          filtro === f.clave ? 'bg-teal-profundo text-white' : 'border-[1.5px] border-linea text-secundario hover:border-teal-profundo')}>
                        {f.etiqueta} · {n}
                      </button>
                    );
                  })}
                </div>
                {visibles.length === 0 ? (
                  <p className="py-10 text-center text-secundario">Ninguna transacción en este filtro.</p>
                ) : (
                  <ul className="-mx-2 divide-y divide-linea sm:-mx-3">
                    {visibles.map((p) => <FilaTransaccion key={p.id} p={{ ...p, dias: p.dias_habiles_en_etapa }} />)}
                  </ul>
                )}
              </>
            )}
          </Tarjeta>
        </>
      )}
    </>
  );
}
