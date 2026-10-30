import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Diálogo modal accesible sobre <dialog> nativo (sin alert/confirm del navegador). */
export function Dialogo({ abierto, alCerrar, kicker, titulo, children, pie }: {
  abierto: boolean; alCerrar: () => void; kicker?: string; titulo: string; children: ReactNode; pie?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog ref={ref} onClose={alCerrar} onCancel={alCerrar}
      className="w-[min(560px,calc(100vw-32px))] rounded-tarjeta border border-linea bg-white p-0 text-tinta shadow-flotante backdrop:bg-navy-oscuro/60">
      {abierto && (
        <div className="relative">
          <div aria-hidden className="h-[5px] bg-regla" />
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div>
              {kicker && <p className="kicker mb-1.5 text-[12px]">{kicker}</p>}
              <h2 className="titular text-[26px]">{titulo}</h2>
            </div>
            <button type="button" onClick={alCerrar} aria-label="Cerrar" className="rounded-lg p-1.5 text-meta hover:bg-papel hover:text-tinta">
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
          <div className="px-6 py-5">{children}</div>
          {pie && <div className="flex flex-wrap justify-end gap-3 border-t border-linea bg-papel/60 px-6 py-4">{pie}</div>}
        </div>
      )}
    </dialog>
  );
}
