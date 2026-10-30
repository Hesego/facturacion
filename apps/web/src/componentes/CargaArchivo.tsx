import { useId, useRef, useState, type DragEvent } from 'react';
import { FileUp, Paperclip, X } from 'lucide-react';
import { formatearTamano } from '../formato';
import { cx } from './ui';
import { BotonVer, useVisor, VisorArchivo } from './VisorArchivo';

export const ACEPTA_SOPORTES = '.pdf,.png,.jpg,.jpeg,.xml,.zip,application/pdf,image/png,image/jpeg,application/xml,text/xml,application/zip';
export const ACEPTA_FACTURA = '.pdf,.xml,.zip,application/pdf,application/xml,text/xml,application/zip';


/** Selector de archivo con arrastrar y soltar. */
export function CargaArchivo({ archivo, alCambiar, acepta = ACEPTA_SOPORTES, texto = 'Arrastra el archivo o haz clic para elegirlo', invalido, deshabilitado }: {
  archivo: File | null; alCambiar: (f: File | null) => void; acepta?: string; texto?: string; invalido?: boolean; deshabilitado?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  const soltar = (e: DragEvent) => {
    e.preventDefault();
    setEncima(false);
    const f = e.dataTransfer.files[0];
    if (f && !deshabilitado) alCambiar(f);
  };

  if (archivo) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-[1.5px] border-teal-profundo/40 bg-teal-profundo/5 px-3.5 py-2.5">
        <Paperclip className="h-[18px] w-[18px] shrink-0 text-teal-profundo" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate text-[15px]">{archivo.name}</span>
        <span className="shrink-0 text-[13px] text-meta">{formatearTamano(archivo.size)}</span>
        <button type="button" onClick={() => { alCambiar(null); if (ref.current) ref.current.value = ''; }}
          aria-label={`Quitar ${archivo.name}`} className="rounded-md p-1 text-meta hover:bg-white hover:text-rojo">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    );
  }
  return (
    <label htmlFor={id}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)} onDrop={soltar}
      className={cx('flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-dashed px-4 py-3.5 text-[15px] text-secundario transition-colors',
        encima ? 'border-teal-profundo bg-teal-profundo/5' : invalido ? 'border-rojo' : 'border-linea bg-white hover:border-teal-profundo',
        deshabilitado && 'pointer-events-none opacity-50')}>
      <FileUp className="h-5 w-5 shrink-0 text-teal-profundo" strokeWidth={2} />
      <span>{texto}</span>
      <input ref={ref} id={id} type="file" accept={acepta} className="sr-only" disabled={deshabilitado}
        onChange={(e) => alCambiar(e.target.files?.[0] ?? null)} />
    </label>
  );
}

/** Extensiones de un `accept` («.pdf,.png,…»), para filtrar lo que se arrastra. */
const extensiones = (acepta: string) => acepta.split(',').filter((x) => x.startsWith('.')).map((x) => x.toLowerCase());

/** Varios archivos con arrastrar y soltar. */
export function CargaArchivos({ archivos, alCambiar, texto, textoOtro = 'Agregar otro archivo', invalido, maximo = 10, acepta = ACEPTA_SOPORTES }: {
  archivos: File[]; alCambiar: (f: File[]) => void; texto: string; textoOtro?: string; invalido?: boolean; maximo?: number; acepta?: string;
}) {
  const id = useId();
  const [encima, setEncima] = useState(false);
  const visor = useVisor();
  const permitidas = extensiones(acepta);
  const agregar = (nuevos: FileList | null) => {
    if (!nuevos) return;
    const lista = [...archivos];
    for (const f of Array.from(nuevos)) {
      const ok = permitidas.some((e) => f.name.toLowerCase().endsWith(e));
      if (ok && !lista.some((x) => x.name === f.name && x.size === f.size)) lista.push(f);
    }
    alCambiar(lista.slice(0, maximo));
  };
  return (
    <div className="space-y-2">
      {archivos.map((a) => (
        <div key={a.name + a.size} className="flex items-center gap-3 rounded-xl border-[1.5px] border-teal-profundo/40 bg-teal-profundo/5 px-3.5 py-2.5">
          <Paperclip className="h-[18px] w-[18px] shrink-0 text-teal-profundo" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate text-[15px]">{a.name}</span>
          <span className="shrink-0 text-[13px] text-meta">{formatearTamano(a.size)}</span>
          <BotonVer vista={{ nombre: a.name, archivo: a }} alVer={visor.ver} />
          <button type="button" onClick={() => alCambiar(archivos.filter((x) => x !== a))} aria-label={`Quitar ${a.name}`}
            className="rounded-md p-1 text-meta hover:bg-white hover:text-rojo"><X className="h-4 w-4" strokeWidth={2} /></button>
        </div>
      ))}
      <VisorArchivo vista={visor.vista} alCerrar={visor.cerrar} />
      {archivos.length < maximo && (
        <label htmlFor={id}
          onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
          onDrop={(e) => { e.preventDefault(); setEncima(false); agregar(e.dataTransfer.files); }}
          className={cx('flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-dashed px-4 py-4 text-[15px] text-secundario transition-colors',
            encima ? 'border-teal-profundo bg-teal-profundo/5' : invalido ? 'border-rojo' : 'border-linea bg-white hover:border-teal-profundo')}>
          <FileUp className="h-6 w-6 shrink-0 text-teal-profundo" strokeWidth={2} />
          <span>{archivos.length ? textoOtro : texto}</span>
          <input id={id} type="file" multiple accept={acepta} className="sr-only" onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
}
