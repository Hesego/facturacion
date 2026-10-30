// Componentes base del sistema visual Hesego (Manual de Marca v1.1, láminas 11 a 14).
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Regla de color: barra de 6 px, degradado naranja → teal, siempre bajo el titular. */
export const ReglaColor = ({ className }: { className?: string }) => (
  <div aria-hidden className={cx('h-1.5 w-28 rounded-full bg-regla sm:w-40', className)} />
);

/** Kicker + titular (una idea por titular) + regla de color. */
export function EncabezadoPagina({ kicker, titulo, children, acciones }: { kicker: string; titulo: ReactNode; children?: ReactNode; acciones?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="kicker mb-2">{kicker}</p>
        <h1 className="titular text-[34px] sm:text-[44px]">{titulo}</h1>
        <ReglaColor className="mt-4" />
        {children && <p className="mt-4 max-w-2xl text-[17px] text-secundario">{children}</p>}
      </div>
      {acciones && <div className="flex shrink-0 flex-wrap gap-3">{acciones}</div>}
    </header>
  );
}

export function Tarjeta({ children, className, acento = 'teal', titulo, kicker, extra }: {
  children: ReactNode; className?: string; acento?: 'teal' | 'naranja' | 'ninguno'; titulo?: ReactNode; kicker?: string; extra?: ReactNode;
}) {
  return (
    <section className={cx('tarjeta', acento === 'teal' && 'tarjeta-acento', acento === 'naranja' && 'tarjeta-acento-naranja', className)}>
      {(titulo || kicker) && (
        <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-6 sm:px-6">
          <div>
            {kicker && <p className="kicker mb-1.5 text-[12px]">{kicker}</p>}
            {titulo && <h2 className="titular text-[22px]">{titulo}</h2>}
          </div>
          {extra}
        </div>
      )}
      <div className={cx('px-5 pb-5 sm:px-6 sm:pb-6', titulo || kicker ? 'pt-3' : 'pt-6')}>{children}</div>
    </section>
  );
}

type Variante = 'primario' | 'accion' | 'secundario' | 'peligro' | 'fantasma';
const VARIANTES: Record<Variante, string> = {
  // Teal profundo con texto blanco: contraste 4,9:1
  primario: 'bg-teal-profundo text-white hover:bg-[#086B78] shadow-sm',
  // Naranja profundo para texto blanco: 5,0:1 (el naranja vivo no alcanza con texto pequeño)
  accion: 'bg-naranja-profundo text-white hover:bg-[#9A4708] shadow-sm',
  secundario: 'border-[1.5px] border-linea bg-white text-tinta hover:border-teal-profundo hover:text-teal-profundo',
  peligro: 'bg-rojo text-white hover:bg-[#A93226] shadow-sm',
  fantasma: 'text-teal-profundo hover:bg-teal-profundo/10',
};

export const Boton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante; cargando?: boolean; icono?: ReactNode; tamano?: 'normal' | 'grande';
}>(function Boton({ variante = 'primario', cargando, icono, tamano = 'normal', className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tamano === 'grande' ? 'px-6 py-3.5 text-[17px]' : 'px-4 py-2.5 text-[15px]',
        VARIANTES[variante], className,
      )}
      {...props}
    >
      {cargando ? <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2} /> : icono}
      {children}
    </button>
  );
});

/** Chip / píldora: Rajdhani en mayúsculas, borde línea sobre claro (lámina 14). */
export function Chip({ children, tono = 'neutro', className }: { children: ReactNode; tono?: 'neutro' | 'teal' | 'naranja' | 'verde' | 'rojo'; className?: string }) {
  const tonos = {
    neutro: 'border-[1.5px] border-linea bg-white text-secundario',
    teal: 'bg-teal-profundo text-white',
    naranja: 'bg-naranja-profundo text-white',
    verde: 'border-[1.5px] border-verde/40 bg-verde/10 text-tinta',
    rojo: 'bg-rojo text-white',
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 font-etiqueta text-[13px] font-bold uppercase leading-none tracking-chip', tonos[tono], className)}>
      {children}
    </span>
  );
}

export function Campo({ etiqueta, error, ayuda, children, requerido, id }: {
  etiqueta: string; error?: string; ayuda?: ReactNode; children: ReactNode; requerido?: boolean; id?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-etiqueta text-[14px] font-bold uppercase tracking-chip text-secundario">
        {etiqueta}{requerido && <span className="text-naranja-profundo"> *</span>}
      </label>
      {children}
      {error ? <p role="alert" className="mt-1.5 text-[14px] text-rojo">{error}</p>
        : ayuda ? <p className="mt-1.5 text-[14px] text-meta">{ayuda}</p> : null}
    </div>
  );
}

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalido?: boolean }>(
  function Entrada({ invalido, className, ...p }, ref) {
    return <input ref={ref} aria-invalid={invalido || undefined} className={cx('campo', invalido && 'campo-error', className)} {...p} />;
  });

export const Seleccion = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalido?: boolean }>(
  function Seleccion({ invalido, className, ...p }, ref) {
    return <select ref={ref} aria-invalid={invalido || undefined} className={cx('campo appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10', invalido && 'campo-error', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233B565F' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p} />;
  });

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalido?: boolean }>(
  function AreaTexto({ invalido, className, ...p }, ref) {
    return <textarea ref={ref} aria-invalid={invalido || undefined} className={cx('campo min-h-[96px] resize-y', invalido && 'campo-error', className)} {...p} />;
  });

export function Alerta({ tono = 'info', titulo, children }: { tono?: 'info' | 'exito' | 'aviso' | 'error'; titulo?: string; children?: ReactNode }) {
  const t = {
    info: { caja: 'border-teal-profundo/30 bg-teal-profundo/5', icono: <Info className="h-5 w-5 text-teal-profundo" strokeWidth={2} /> },
    exito: { caja: 'border-verde/40 bg-verde/10', icono: <CheckCircle2 className="h-5 w-5 text-verde" strokeWidth={2} /> },
    aviso: { caja: 'border-ambar/50 bg-ambar/10', icono: <AlertTriangle className="h-5 w-5 text-naranja-profundo" strokeWidth={2} /> },
    error: { caja: 'border-rojo/40 bg-rojo/5', icono: <XCircle className="h-5 w-5 text-rojo" strokeWidth={2} /> },
  }[tono];
  return (
    <div role={tono === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border-[1.5px] px-4 py-3', t.caja)}>
      <span className="mt-0.5 shrink-0">{t.icono}</span>
      <div className="min-w-0 text-[15px]">
        {titulo && <p className="font-bold">{titulo}</p>}
        {children && <div className="text-secundario">{children}</div>}
      </div>
    </div>
  );
}

/** Cifra héroe en Saira con su etiqueta en Rajdhani, siempre apiladas (lámina 13). */
export function Cifra({ valor, etiqueta, tono = 'teal' }: { valor: ReactNode; etiqueta: string; tono?: 'teal' | 'naranja' | 'verde' | 'tinta' | 'rojo' }) {
  const color = { teal: 'text-teal-profundo', naranja: 'text-naranja-profundo', verde: 'text-verde', tinta: 'text-tinta', rojo: 'text-rojo' }[tono];
  return (
    <div>
      <p className={cx('cifra text-[52px] sm:text-[60px]', color)}>{valor}</p>
      <p className="mt-2 font-etiqueta text-[13px] font-bold uppercase tracking-kicker text-tinta">{etiqueta}</p>
    </div>
  );
}

export const Cargando = ({ texto = 'Cargando…' }: { texto?: string }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-meta" role="status">
    <Loader2 className="h-5 w-5 animate-spin text-teal-profundo" strokeWidth={2} /> {texto}
  </div>
);

export function Vacio({ icono, titulo, children }: { icono: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-profundo/10 text-teal-profundo">{icono}</span>
      <p className="titular text-[22px]">{titulo}</p>
      {children && <p className="mt-2 max-w-md text-secundario">{children}</p>}
    </div>
  );
}

export function DatoEtiquetado({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-etiqueta text-[12px] font-bold uppercase tracking-chip text-meta">{etiqueta}</dt>
      <dd className="mt-0.5 break-words text-[16px] text-tinta">{children}</dd>
    </div>
  );
}
