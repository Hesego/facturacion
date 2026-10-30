import { useId, useState } from 'react';
import { FileCode2, FileText, FileUp, X } from 'lucide-react';
import { ACEPTA_FACTURA } from './CargaArchivo';
import { cx, Entrada } from './ui';
import { BotonVer, useVisor, VisorArchivo } from './VisorArchivo';

/** Una factura: su PDF y, si lo hay, el XML o ZIP de la DIAN (el ZIP ya trae el PDF). */
export interface FilaFactura {
  clave: string;
  pdf?: File;
  electronica?: File;
  numero: string;
}

const base = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();
const es = (f: File, ...ext: string[]) => ext.some((e) => f.name.toLowerCase().endsWith(e));
export const tieneXml = (f: FilaFactura) => !!f.electronica;
/** Le falta algo para poder enviarse. */
export const faltaEnFila = (f: FilaFactura) =>
  !f.pdf && !(f.electronica && es(f.electronica, '.zip')) ? 'Falta el PDF' : !f.numero.trim() && !tieneXml(f) ? 'Escribe el número' : null;

/** Archivos para el formulario: factura_<i> (PDF y XML/ZIP) y su número en numero_<i>. */
export function archivosFacturas(filas: FilaFactura[]) {
  const archivos: [string, File][] = [];
  const campos: Record<string, string> = {};
  filas.forEach((f, i) => {
    if (f.pdf) archivos.push([`factura_${i}`, f.pdf]);
    if (f.electronica) archivos.push([`factura_${i}`, f.electronica]);
    if (f.numero.trim()) campos[`numero_${i}`] = f.numero.trim();
  });
  return { archivos, campos };
}

/**
 * Agrupa lo que se arrastra en facturas: cada PDF o ZIP es una factura; un XML se une al PDF de
 * igual nombre (o al único PDF sin XML). Las imágenes no son facturas: se pasan a `alSoportes`.
 */
function agrupar(filas: FilaFactura[], nuevos: File[]): { filas: FilaFactura[]; imagenes: File[] } {
  const lista = filas.map((f) => ({ ...f }));
  const imagenes: File[] = [];
  const nueva = (f: Partial<FilaFactura>) => lista.push({ clave: crypto.randomUUID(), numero: '', ...f });
  const xmls: File[] = [];
  for (const f of nuevos) {
    if (es(f, '.png', '.jpg', '.jpeg')) imagenes.push(f);
    else if (es(f, '.pdf')) {
      const pareja = lista.find((x) => !x.pdf && x.electronica && base(x.electronica.name) === base(f.name));
      if (pareja) pareja.pdf = f; else nueva({ pdf: f, numero: '' });
    } else if (es(f, '.zip')) nueva({ electronica: f });
    else if (es(f, '.xml')) xmls.push(f);
  }
  for (const x of xmls) {
    const sinXml = lista.filter((f) => f.pdf && !f.electronica);
    const pareja = sinXml.find((f) => base(f.pdf!.name) === base(x.name)) ?? (sinXml.length === 1 ? sinXml[0] : undefined);
    if (pareja) pareja.electronica = x; else nueva({ electronica: x });
  }
  return { filas: lista, imagenes };
}

export function SelectorFacturas({ filas, alCambiar, alSoportes, intentado }: {
  filas: FilaFactura[]; alCambiar: (f: FilaFactura[]) => void; alSoportes?: (imagenes: File[]) => void; intentado?: boolean;
}) {
  const id = useId();
  const [encima, setEncima] = useState(false);
  const visor = useVisor();
  const agregar = (lista: FileList | null) => {
    if (!lista) return;
    const r = agrupar(filas, Array.from(lista));
    alCambiar(r.filas.slice(0, 15));
    if (r.imagenes.length) alSoportes?.(r.imagenes);
  };
  const cambiar = (clave: string, cambios: Partial<FilaFactura>) => alCambiar(filas.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));

  return (
    <div className="space-y-2">
      {filas.map((f, i) => {
        const error = intentado ? faltaEnFila(f) : null;
        return (
          <div key={f.clave} className={cx('rounded-xl border-[1.5px] px-3.5 py-3', error ? 'border-rojo/60 bg-rojo/5' : 'border-teal-profundo/40 bg-teal-profundo/5')}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 font-etiqueta text-[13px] font-bold text-teal-profundo">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-1 text-[14px]">
                {f.pdf && (
                  <p className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-teal-profundo" strokeWidth={2} />
                    <span className="truncate">{f.pdf.name}</span><BotonVer vista={{ nombre: f.pdf.name, archivo: f.pdf }} alVer={visor.ver} /></p>
                )}
                {f.electronica && (
                  <p className="flex items-center gap-2"><FileCode2 className="h-4 w-4 shrink-0 text-teal-profundo" strokeWidth={2} />
                    <span className="truncate">{f.electronica.name}</span><BotonVer vista={{ nombre: f.electronica.name, archivo: f.electronica }} alVer={visor.ver} /></p>
                )}
              </div>
              <button type="button" onClick={() => alCambiar(filas.filter((x) => x.clave !== f.clave))} aria-label={`Quitar factura ${i + 1}`}
                className="rounded-md p-1 text-meta hover:bg-white hover:text-rojo"><X className="h-4 w-4" strokeWidth={2} /></button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 pl-6">
              <label className="sr-only" htmlFor={`${id}-n${i}`}>Número de la factura {i + 1}</label>
              <Entrada id={`${id}-n${i}`} className="max-w-[220px] py-2" value={f.numero} onChange={(e) => cambiar(f.clave, { numero: e.target.value })}
                placeholder={tieneXml(f) ? 'Se lee del XML' : 'Número de la factura'} invalido={!!error && error.includes('número')} />
              {error && <span role="alert" className="text-[14px] text-rojo">{error}{error === 'Falta el PDF' ? ' de esta factura' : ''}</span>}
            </div>
          </div>
        );
      })}
      <VisorArchivo vista={visor.vista} alCerrar={visor.cerrar} />
      <label htmlFor={id}
        onDragOver={(e) => { e.preventDefault(); setEncima(true); }} onDragLeave={() => setEncima(false)}
        onDrop={(e) => { e.preventDefault(); setEncima(false); agregar(e.dataTransfer.files); }}
        className={cx('flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-dashed px-4 py-5 text-[15px] text-secundario transition-colors',
          encima ? 'border-teal-profundo bg-teal-profundo/5' : intentado && !filas.length ? 'border-rojo' : 'border-linea bg-white hover:border-teal-profundo')}>
        <FileUp className="h-6 w-6 shrink-0 text-teal-profundo" strokeWidth={2} />
        <span>{filas.length ? 'Agregar otra factura' : 'Arrastra las facturas (PDF y, si los tienes, sus XML o ZIP de la DIAN) o haz clic para elegirlas'}</span>
        <input id={id} type="file" multiple accept={`${ACEPTA_FACTURA},.png,.jpg,.jpeg,image/png,image/jpeg`} className="sr-only"
          onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
      </label>
    </div>
  );
}
