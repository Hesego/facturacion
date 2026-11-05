import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, SearchX } from 'lucide-react';
import { api, ErrorApi } from '../../api/cliente';
import { Dialogo } from '../../componentes/Dialogo';
import { Alerta, Boton, Cargando, cx, Entrada, Seleccion, Vacio } from '../../componentes/ui';

export const useAdmin = <T,>(ruta: string) =>
  useQuery({ queryKey: ['admin', ruta], queryFn: () => api.get<T[]>(`/admin/${ruta}`) });

/** Guarda y recarga todo lo de administración (y los catálogos que usan los formularios). */
export function useGuardar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ metodo, ruta, cuerpo }: { metodo: 'post' | 'put' | 'patch'; ruta: string; cuerpo: unknown }) => api[metodo](`/admin/${ruta}`, cuerpo),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['catalogos'] }), qc.invalidateQueries({ queryKey: ['yo'] })]),
  });
}

/** Mensaje de error de la API, con los campos que fallaron. */
export function ErrorGuardado({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ErrorApi;
  return <Alerta tono="error">{e.message}</Alerta>;
}

export function Interruptor({ activo, alCambiar, etiqueta, ayuda }: { activo: boolean; alCambiar: (v: boolean) => void; etiqueta: string; ayuda?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={activo} onClick={() => alCambiar(!activo)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', activo ? 'bg-teal-profundo' : 'bg-linea')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', activo ? 'left-[22px]' : 'left-0.5')} />
      </button>
      <span><span className="font-bold">{etiqueta}</span>{ayuda && <span className="block text-[14px] text-meta">{ayuda}</span>}</span>
    </label>
  );
}

export function Casillas<V extends string | number>({ opciones, valor, alCambiar }: {
  opciones: { valor: V; etiqueta: string; detalle?: string }[]; valor: V[]; alCambiar: (v: V[]) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {opciones.map((o) => {
        const marcado = valor.includes(o.valor);
        return (
          <label key={String(o.valor)} className={cx('flex cursor-pointer items-start gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 text-[15px]',
            marcado ? 'border-teal-profundo bg-teal-profundo/5' : 'border-linea hover:border-teal-profundo/50')}>
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[#0A7D8C]" checked={marcado}
              onChange={() => alCambiar(marcado ? valor.filter((x) => x !== o.valor) : [...valor, o.valor])} />
            <span>{o.etiqueta}{o.detalle && <span className="block text-[13px] text-meta">{o.detalle}</span>}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Texto en minúsculas y sin tildes, para buscar «Área» escribiendo «area». */
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtro de lista desplegable de una tabla de administración. El valor vacío es «todos». */
export interface FiltroAdmin<T> {
  id: string;
  /** Texto de la opción «todos», p. ej. «Todos los equipos». */
  todos: string;
  opciones: { valor: string; etiqueta: string }[];
  cumple: (fila: T, valor: string) => boolean;
}

/** Filtro de estado común a todas las tablas (activo / inactivo). */
export const filtroEstado = <T,>(activo: (f: T) => boolean): FiltroAdmin<T> => ({
  id: 'estado', todos: 'Todos los estados',
  opciones: [{ valor: 'activo', etiqueta: 'Activos' }, { valor: 'inactivo', etiqueta: 'Inactivos' }],
  cumple: (f, v) => activo(f) === (v === 'activo'),
});

const TAMANOS_PAGINA = [10, 25, 50];

/**
 * Tabla de administración con búsqueda, filtros, paginación, botón «Nuevo» y edición en diálogo.
 * Filtra y pagina en el navegador: la API devuelve la lista completa (son catálogos pequeños).
 */
export function SeccionAdmin<T extends { id: number }>({ titulo, descripcion, filas, cargando, columnas, nuevo, editar, textoNuevo, buscarEn, textoBuscar, filtros = [] }: {
  titulo: string; descripcion: ReactNode; filas: T[] | undefined; cargando: boolean;
  columnas: { titulo: string; celda: (f: T) => ReactNode; clase?: string }[];
  nuevo?: () => void; editar: (f: T) => void; textoNuevo?: string;
  /** Textos de la fila donde busca la caja de búsqueda; sin esto no hay búsqueda. */
  buscarEn?: (f: T) => (string | null | undefined)[];
  textoBuscar?: string;
  filtros?: FiltroAdmin<T>[];
}) {
  const [busqueda, setBusqueda] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(TAMANOS_PAGINA[0]!);

  const q = normalizar(busqueda.trim());
  const filtradas = (filas ?? []).filter((f) =>
    (!q || !buscarEn || buscarEn(f).some((t) => t && normalizar(t).includes(q)))
    && filtros.every((fl) => !valores[fl.id] || fl.cumple(f, valores[fl.id]!)));

  const paginas = Math.max(1, Math.ceil(filtradas.length / tamano));
  // Al filtrar, o si quedan menos filas tras guardar, la página actual puede dejar de existir
  const actual = Math.min(pagina, paginas);
  const visibles = filtradas.slice((actual - 1) * tamano, actual * tamano);
  const hayFiltros = !!q || Object.values(valores).some(Boolean);
  const cambiarFiltro = (id: string, v: string) => { setValores((x) => ({ ...x, [id]: v })); setPagina(1); };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="titular text-[26px]">{titulo}</h2>
          <p className="mt-1 max-w-2xl text-secundario">{descripcion}</p>
        </div>
        {nuevo && <Boton onClick={nuevo} icono={<Plus className="h-[18px] w-[18px]" strokeWidth={2} />}>{textoNuevo ?? 'Nuevo'}</Boton>}
      </div>
      {cargando || !filas ? <Cargando /> : (
        <div className="tarjeta">
          {(buscarEn || filtros.length > 0) && (
            <div className="flex flex-wrap gap-3 border-b border-linea p-4">
              {buscarEn && (
                <label className="relative min-w-[220px] flex-1">
                  <span className="sr-only">Buscar en {titulo.toLowerCase()}</span>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-meta" strokeWidth={2} />
                  <Entrada value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(1); }} placeholder={textoBuscar ?? 'Buscar…'} className="pl-11" />
                </label>
              )}
              {filtros.map((fl) => (
                <Seleccion key={fl.id} aria-label={fl.todos} value={valores[fl.id] ?? ''} onChange={(e) => cambiarFiltro(fl.id, e.target.value)}
                  className="w-full sm:w-auto sm:min-w-[190px] sm:max-w-[260px]">
                  <option value="">{fl.todos}</option>
                  {fl.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                </Seleccion>
              ))}
              {hayFiltros && (
                <Boton variante="fantasma" onClick={() => { setBusqueda(''); setValores({}); setPagina(1); }}>Limpiar filtros</Boton>
              )}
            </div>
          )}
          {filtradas.length === 0 ? (
            <div className="p-6">
              <Vacio icono={<SearchX className="h-7 w-7" strokeWidth={2} />} titulo="Sin resultados">
                {hayFiltros ? 'Prueba con otra búsqueda o quita algún filtro.' : 'Todavía no hay registros.'}
              </Vacio>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[15px]">
                <thead className="bg-papel/70">
                  <tr>
                    {columnas.map((c) => <th key={c.titulo} className={cx('px-4 py-3 font-etiqueta text-[12px] font-bold uppercase tracking-chip text-meta', c.clase)}>{c.titulo}</th>)}
                    <th className="w-14" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-linea">
                  {visibles.map((f) => (
                    <tr key={f.id} className="hover:bg-papel/50">
                      {columnas.map((c) => <td key={c.titulo} className={cx('px-4 py-3 align-top', c.clase)}>{c.celda(f)}</td>)}
                      <td className="px-2 py-2 text-right">
                        <button onClick={() => editar(f)} aria-label="Editar" className="rounded-lg p-2 text-teal-profundo hover:bg-teal-profundo/10">
                          <Pencil className="h-[18px] w-[18px]" strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filtradas.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linea px-4 py-3">
              <div className="flex flex-wrap items-center gap-3 text-[14px] text-meta">
                <span className="tabular-nums">
                  {(actual - 1) * tamano + 1}–{Math.min(actual * tamano, filtradas.length)} de {filtradas.length}
                  {filtradas.length !== filas.length && ` (de ${filas.length} en total)`}
                </span>
                <Seleccion aria-label="Filas por página" value={tamano} onChange={(e) => { setTamano(Number(e.target.value)); setPagina(1); }} className="w-auto py-1.5">
                  {TAMANOS_PAGINA.map((n) => <option key={n} value={n}>{n} por página</option>)}
                </Seleccion>
              </div>
              {paginas > 1 && (
                <div className="flex items-center gap-2">
                  <Boton variante="secundario" disabled={actual <= 1} onClick={() => setPagina(actual - 1)}
                    icono={<ChevronLeft className="h-4 w-4" strokeWidth={2} />}>Anterior</Boton>
                  <span className="font-etiqueta text-[13px] font-bold uppercase tracking-chip text-meta">Página {actual} de {paginas}</span>
                  <Boton variante="secundario" disabled={actual >= paginas} onClick={() => setPagina(actual + 1)}>
                    Siguiente <ChevronRight className="h-4 w-4" strokeWidth={2} />
                  </Boton>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Diálogo de formulario: maneja guardar, error y cierre. */
export function DialogoFormulario({ abierto, alCerrar, kicker, titulo, alGuardar, children, cargando, error }: {
  abierto: boolean; alCerrar: () => void; kicker: string; titulo: string; alGuardar: () => void; children: ReactNode; cargando: boolean; error: unknown;
}) {
  return (
    <Dialogo abierto={abierto} alCerrar={alCerrar} kicker={kicker} titulo={titulo}
      pie={<><Boton variante="fantasma" onClick={alCerrar}>Cancelar</Boton><Boton onClick={alGuardar} cargando={cargando}>Guardar</Boton></>}>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <ErrorGuardado error={error} />
        {children}
      </div>
    </Dialogo>
  );
}

export const Estado = ({ activo }: { activo: boolean }) => (
  <span className={cx('font-etiqueta text-[13px] font-bold uppercase tracking-chip', activo ? 'text-teal-profundo' : 'text-meta')}>{activo ? 'Activo' : 'Inactivo'}</span>
);

/** Estado local de un formulario de diálogo: abrir con datos, editar campos, cerrar. */
export function useFormulario<F>(inicial: F) {
  const [abierto, setAbierto] = useState(false);
  const [id, setId] = useState<number | null>(null);
  const [f, setF] = useState<F>(inicial);
  return {
    abierto, id, f,
    abrir: (datos: F, idEditar: number | null = null) => { setF(datos); setId(idEditar); setAbierto(true); },
    cerrar: () => setAbierto(false),
    campo: <K extends keyof F>(k: K, v: F[K]) => setF((x) => ({ ...x, [k]: v })),
  };
}

