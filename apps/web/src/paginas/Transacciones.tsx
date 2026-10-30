import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, SearchX } from 'lucide-react';
import { useCatalogos, useListado } from '../api/consultas';
import { Alerta, Boton, Cargando, EncabezadoPagina, Entrada, Seleccion, Tarjeta, Vacio } from '../componentes/ui';
import { FilaTransaccion } from './Pendientes';

export function Transacciones() {
  const [params, setParams] = useSearchParams();
  const { data: cat } = useCatalogos();
  const [busqueda, setBusqueda] = useState(params.get('q') ?? '');
  const filtro = {
    q: params.get('q') ?? undefined,
    estado: params.get('estado') ?? undefined,
    etapa: params.get('etapa') ?? undefined,
    areaId: params.get('areaId') ?? undefined,
    pagina: Number(params.get('pagina') ?? 1),
    porPagina: 20,
  };
  const { data, isLoading, isFetching, error } = useListado(filtro);

  const cambiar = (clave: string, valor: string) => {
    const p = new URLSearchParams(params);
    if (valor) p.set(clave, valor); else p.delete(clave);
    if (clave !== 'pagina') p.delete('pagina');
    setParams(p, { replace: true });
  };

  // Búsqueda con espera de 300 ms para no consultar en cada tecla
  useEffect(() => {
    const t = setTimeout(() => { if (busqueda !== (params.get('q') ?? '')) cambiar('q', busqueda.trim()); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  const paginas = data ? Math.max(1, Math.ceil(data.total / data.porPagina)) : 1;

  return (
    <>
      <EncabezadoPagina kicker="Consulta" titulo="Transacciones">
        Busca por consecutivo, número de factura, RQ, OC o ES, descripción, proveedor o persona a cargo.
      </EncabezadoPagina>

      <Tarjeta acento="ninguno" className="mb-6">
        <div className="grid gap-3 md:grid-cols-[1fr_170px_220px_220px]">
          <label className="relative">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-meta" strokeWidth={2} />
            <Entrada value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="GTO-2026-000012, FE-4101, RQ-4410…" className="pl-11" />
          </label>
          <Seleccion aria-label="Estado" value={filtro.estado ?? ''} onChange={(e) => cambiar('estado', e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="en_curso">En curso</option>
            <option value="pagada">Pagadas</option>
            <option value="anulada">Anuladas</option>
          </Seleccion>
          <Seleccion aria-label="Etapa" value={filtro.etapa ?? ''} onChange={(e) => cambiar('etapa', e.target.value)}>
            <option value="">Todas las etapas</option>
            {cat?.etapas.map((e) => <option key={e.id} value={e.codigo}>{e.codigo} · {e.nombre}</option>)}
          </Seleccion>
          <Seleccion aria-label="Área" value={filtro.areaId ?? ''} onChange={(e) => cambiar('areaId', e.target.value)}>
            <option value="">Todas las áreas</option>
            {cat?.areas.map((a) => <option key={a.id} value={a.id}>{a.equipo} · {a.nombre}</option>)}
          </Seleccion>
        </div>
      </Tarjeta>

      {isLoading ? <Cargando /> : error ? <Alerta tono="error">{error.message}</Alerta> : (
        <Tarjeta kicker={`${data!.total} resultado${data!.total === 1 ? '' : 's'}`} className={isFetching ? 'opacity-70 transition-opacity' : ''}>
          {data!.filas.length === 0 ? (
            <Vacio icono={<SearchX className="h-7 w-7" strokeWidth={2} />} titulo="Sin resultados">Prueba con otra búsqueda o quita algún filtro.</Vacio>
          ) : (
            <>
              <ul className="-mx-2 divide-y divide-linea sm:-mx-3">
                {data!.filas.map((f) => (
                  <FilaTransaccion key={f.id} p={{ ...f, dias: f.dias_habiles_en_etapa }} />
                ))}
              </ul>
              {paginas > 1 && (
                <div className="mt-5 flex items-center justify-between border-t border-linea pt-5">
                  <Boton variante="secundario" disabled={filtro.pagina <= 1} onClick={() => cambiar('pagina', String(filtro.pagina - 1))}
                    icono={<ChevronLeft className="h-4 w-4" strokeWidth={2} />}>Anterior</Boton>
                  <span className="font-etiqueta text-[14px] font-bold uppercase tracking-chip text-meta">Página {filtro.pagina} de {paginas}</span>
                  <Boton variante="secundario" disabled={filtro.pagina >= paginas} onClick={() => cambiar('pagina', String(filtro.pagina + 1))}>
                    Siguiente <ChevronRight className="h-4 w-4" strokeWidth={2} />
                  </Boton>
                </div>
              )}
            </>
          )}
        </Tarjeta>
      )}
    </>
  );
}
