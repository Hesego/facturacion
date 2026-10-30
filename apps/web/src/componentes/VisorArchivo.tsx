import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Loader2, X } from 'lucide-react';
import { cx } from './ui';

/** Lo que se va a ver: un archivo local (antes de enviarlo) o un adjunto ya cargado. */
export type Vista = { nombre: string; archivo: File } | { nombre: string; mime: string; adjuntoId: number };

type Clase = 'pdf' | 'imagen' | 'xml';
/** Qué se puede mostrar en pantalla: PDF, imágenes y XML. El ZIP no. */
export function claseVista(nombre: string, mime?: string): Clase | null {
  const n = nombre.toLowerCase();
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (mime?.startsWith('image/') || /\.(png|jpe?g)$/.test(n)) return 'imagen';
  if (mime === 'application/xml' || mime === 'text/xml' || n.endsWith('.xml')) return 'xml';
  return null;
}

/** Botón «Ver» para poner junto a un archivo. No aparece si el tipo no se puede mostrar. */
export function BotonVer({ vista, alVer, compacto }: { vista: Vista; alVer: (v: Vista) => void; compacto?: boolean }) {
  const clase = claseVista(vista.nombre, 'mime' in vista ? vista.mime : vista.archivo.type);
  if (!clase) return null;
  return (
    <button type="button" onClick={() => alVer(vista)} aria-label={`Ver ${vista.nombre}`} title="Ver sin descargar"
      className={cx('inline-flex items-center gap-1 rounded-lg font-bold text-teal-profundo hover:bg-teal-profundo/10',
        compacto ? 'p-1.5' : 'px-1.5 py-1 text-[14px]')}>
      <Eye className="h-[18px] w-[18px]" strokeWidth={2} />{!compacto && 'Ver'}
    </button>
  );
}

/**
 * Visor de archivos dentro de la aplicación: muestra el PDF, la imagen o el XML sin descargarlo,
 * para confirmar que es el documento correcto antes de enviarlo o de aprobar.
 */
export function VisorArchivo({ vista, alCerrar }: { vista: Vista | null; alCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clase = vista ? claseVista(vista.nombre, 'mime' in vista ? vista.mime : vista.archivo.type) : null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (vista && !d.open) d.showModal();
    if (!vista && d.open) d.close();
  }, [vista]);

  useEffect(() => {
    setUrl(null); setTexto(null); setError(null);
    if (!vista || !clase) return;
    let local: string | null = null;
    if ('archivo' in vista) {
      if (clase === 'xml') vista.archivo.text().then(setTexto, () => setError('No se pudo leer el archivo'));
      else setUrl((local = URL.createObjectURL(vista.archivo)));
    } else {
      const ruta = `/api/adjuntos/${vista.adjuntoId}/ver`;
      if (clase === 'xml') fetch(ruta, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : Promise.reject())).then(setTexto, () => setError('No se pudo cargar el archivo'));
      else setUrl(ruta);
    }
    return () => { if (local) URL.revokeObjectURL(local); };
  }, [vista, clase]);

  return (
    <dialog ref={ref} onClose={alCerrar} onCancel={alCerrar}
      className="h-[min(92vh,1000px)] w-[min(1100px,calc(100vw-24px))] overflow-hidden rounded-tarjeta border border-linea bg-white p-0 text-tinta shadow-flotante backdrop:bg-navy-oscuro/70">
      {vista && (
        <div className="flex h-full flex-col">
          <div aria-hidden className="h-[5px] shrink-0 bg-regla" />
          <div className="flex shrink-0 items-center gap-3 border-b border-linea px-5 py-3">
            <Eye className="h-5 w-5 shrink-0 text-teal-profundo" strokeWidth={2} />
            <p className="min-w-0 flex-1 truncate font-bold">{vista.nombre}</p>
            {'adjuntoId' in vista && (
              <a href={`/api/adjuntos/${vista.adjuntoId}/descarga`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-bold text-teal-profundo hover:bg-teal-profundo/10">
                <Download className="h-4 w-4" strokeWidth={2} /> Descargar
              </a>
            )}
            <button type="button" onClick={alCerrar} aria-label="Cerrar visor" className="rounded-lg p-1.5 text-meta hover:bg-papel hover:text-tinta">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-papel">
            {error ? <p className="p-6 text-rojo">{error}</p>
              : clase === 'pdf' && url ? <iframe src={url} title={vista.nombre} className="h-full w-full border-0 bg-white" />
              : clase === 'imagen' && url ? <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={url} alt={vista.nombre} className="max-h-full max-w-full object-contain shadow-tarjeta" /></div>
              : clase === 'xml' && texto !== null ? <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-5 font-mono text-[13px] leading-relaxed text-tinta">{texto}</pre>
              : <div className="flex h-full items-center justify-center gap-2 text-meta"><Loader2 className="h-5 w-5 animate-spin text-teal-profundo" strokeWidth={2} /> Cargando…</div>}
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Estado del visor para una pantalla: qué se está viendo. */
export function useVisor() {
  const [vista, setVista] = useState<Vista | null>(null);
  return { vista, ver: setVista, cerrar: () => setVista(null) };
}
