import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { api, ErrorApi } from '../../api/cliente';
import { Dialogo } from '../../componentes/Dialogo';
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui';

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

/** Tabla de administración con botón «Nuevo» y edición en diálogo. */
export function SeccionAdmin<T extends { id: number }>({ titulo, descripcion, filas, cargando, columnas, nuevo, editar, textoNuevo }: {
  titulo: string; descripcion: ReactNode; filas: T[] | undefined; cargando: boolean;
  columnas: { titulo: string; celda: (f: T) => ReactNode; clase?: string }[];
  nuevo?: () => void; editar: (f: T) => void; textoNuevo?: string;
}) {
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
        <div className="tarjeta overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="bg-papel/70">
              <tr>
                {columnas.map((c) => <th key={c.titulo} className={cx('px-4 py-3 font-etiqueta text-[12px] font-bold uppercase tracking-chip text-meta', c.clase)}>{c.titulo}</th>)}
                <th className="w-14" />
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {filas.map((f) => (
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

