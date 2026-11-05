import { useState, type ReactNode } from 'react';
import { Ban, CheckCircle2, CornerUpLeft, Flag, MessageSquare, Send, Sparkles, UserRoundCog } from 'lucide-react';
import { api } from '../../api/cliente';
import { useAccionTransaccion } from '../../api/consultas';
import type { Detalle } from '../../api/tipos';
import { Alerta, AreaTexto, Boton, cx, Tarjeta, ZonaDesplazable } from '../../componentes/ui';
import { formatearFechaHora } from '../../formato';

type Evento = Detalle['historial'][number];

/**
 * La trazabilidad muestra solo los cambios de estado y los comentarios. Adjuntos, facturas y
 * números de referencia ya se ven en sus propias tarjetas y aquí solo hacían ruido.
 */
const TIPOS_VISIBLES = new Set(['creada', 'avanzada', 'devuelta', 'reasignada', 'anulada', 'cerrada', 'comentario']);

function describir(e: Evento, comentarios: Map<number, string>): { icono: ReactNode; tono: string; titulo: ReactNode; cita?: string | null } {
  const actor = <b>{e.actor ?? 'El sistema'}</b>;
  const datos = e.datos as Record<string, string | null | undefined>;
  const i = 'h-4 w-4';
  switch (e.tipo) {
    case 'creada':
      return { icono: <Sparkles className={i} strokeWidth={2} />, tono: 'bg-teal-profundo', titulo: <>{actor} creó la solicitud</> };
    case 'avanzada':
      return datos.decision === 'aprobado'
        ? { icono: <CheckCircle2 className={i} strokeWidth={2} />, tono: 'bg-verde', titulo: <>{actor} aprobó <b>{e.origen_nombre}</b>{datos.asignado ? <> y la envió a <b>{datos.asignado}</b>{datos.area ? <> ({datos.area})</> : null}</> : null}</>, cita: datos.comentario }
        : { icono: <Send className={i} strokeWidth={2} />, tono: 'bg-teal-profundo',
            titulo: <>{actor} completó <b>{e.origen_nombre}</b> y la envió a {datos.asignado ? <b>{datos.asignado}</b> : e.destino_nombre}{datos.asignado ? <> ({datos.area ? `${datos.area} · ` : ''}{e.destino_nombre})</> : null}</>, cita: datos.comentario };
    case 'devuelta':
      return { icono: <CornerUpLeft className={i} strokeWidth={2} />, tono: 'bg-naranja-profundo',
        titulo: <>{actor} {datos.decision === 'rechazado' ? 'rechazó' : 'devolvió'} <b>{e.origen_nombre}</b> y la regresó a {datos.asignado ? <b>{datos.asignado}</b> : e.destino_nombre} ({e.destino_nombre})</>, cita: e.motivo };
    case 'reasignada':
      return { icono: <UserRoundCog className={i} strokeWidth={2} />, tono: 'bg-meta',
        titulo: <>{actor} pasó la transacción {datos.de ? <>de {datos.de} </> : null}a <b>{datos.asignado}</b>{datos.area ? <> ({datos.area})</> : null}</>, cita: e.motivo };
    case 'anulada':
      return { icono: <Ban className={i} strokeWidth={2} />, tono: 'bg-rojo', titulo: <>{actor} anuló la transacción</>, cita: e.motivo };
    case 'cerrada':
      return { icono: <Flag className={i} strokeWidth={2} />, tono: 'bg-verde', titulo: <>Transacción pagada y cerrada. Le avisamos al solicitante.</> };
    case 'comentario':
      return { icono: <MessageSquare className={i} strokeWidth={2} />, tono: 'bg-teal-vivo', titulo: <>{actor} comentó</>,
        cita: comentarios.get(Number(datos.comentario_id)) };
    default:
      return { icono: <Sparkles className={i} strokeWidth={2} />, tono: 'bg-meta', titulo: <>{actor}: {e.tipo}</> };
  }
}

/** Línea de tiempo del historial (solo inserción) con la conversación de la transacción. */
export function Historial({ d, className }: { d: Detalle; className?: string }) {
  const [texto, setTexto] = useState('');
  const comentar = useAccionTransaccion(d.transaccion.id, () => api.post(`/transacciones/${d.transaccion.id}/comentarios`, { texto }));
  const comentarios = new Map(d.comentarios.map((c) => [c.id, c.texto]));
  const eventos = d.historial.filter((e) => TIPOS_VISIBLES.has(e.tipo)).reverse();

  return (
    <Tarjeta kicker="Trazabilidad" titulo="Historial" className={className}>
      <form className="mb-6" onSubmit={(e) => { e.preventDefault(); comentar.mutate(undefined, { onSuccess: () => setTexto('') }); }}>
        <label htmlFor="comentario" className="sr-only">Escribe un comentario</label>
        <AreaTexto id="comentario" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe un comentario para el equipo…" className="min-h-[72px]" />
        {comentar.error && <div className="mt-2"><Alerta tono="error">{comentar.error.message}</Alerta></div>}
        <div className="mt-2 flex justify-end">
          <Boton type="submit" variante="secundario" disabled={!texto.trim()} cargando={comentar.isPending} icono={<MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} />}>Comentar</Boton>
        </div>
      </form>

      {/* Con desplazamiento propio: un proceso largo no obliga a bajar hasta el final de la página */}
      <ZonaDesplazable etiqueta="Historial de la transacción">
        <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-0.5 before:bg-linea">
          {eventos.map((e) => {
            const x = describir(e, comentarios);
            return (
              <li key={e.id} className="relative flex gap-3.5">
                <span className={cx('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ring-4 ring-white', x.tono)}>{x.icono}</span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[15px] leading-snug">{x.titulo}</p>
                  <p className="mt-0.5 text-[13px] text-meta">{formatearFechaHora(e.ocurrido_en)}</p>
                  {x.cita && <blockquote className="mt-2 rounded-xl border-l-4 border-teal-profundo bg-papel px-3.5 py-2.5 text-[15px] text-tinta">{x.cita}</blockquote>}
                </div>
              </li>
            );
          })}
        </ol>
      </ZonaDesplazable>
    </Tarjeta>
  );
}
