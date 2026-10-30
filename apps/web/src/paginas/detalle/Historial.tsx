import { useState, type ReactNode } from 'react';
import { Ban, CheckCircle2, CornerUpLeft, FilePlus2, FileX2, Flag, Hash, MessageSquare, Paperclip, Send, Sparkles, UserRoundCog } from 'lucide-react';
import { api } from '../../api/cliente';
import { useAccionTransaccion } from '../../api/consultas';
import type { Detalle } from '../../api/tipos';
import { Alerta, AreaTexto, Boton, cx, Tarjeta } from '../../componentes/ui';
import { formatearCOP, formatearFechaHora } from '../../formato';
import { NOMBRE_TIPO_ADJUNTO } from './Soportes';

type Evento = Detalle['historial'][number];

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
      return { icono: <Flag className={i} strokeWidth={2} />, tono: 'bg-verde', titulo: <>Transacción pagada y cerrada. Avisamos a todos los participantes.</> };
    case 'referencia_registrada':
      return { icono: <Hash className={i} strokeWidth={2} />, tono: 'bg-meta',
        titulo: <>{actor} registró {datos.tipo} <b>{datos.numero}</b>{datos.reemplaza ? <> (antes {datos.reemplaza})</> : null}</> };
    case 'factura_agregada':
      return { icono: <FilePlus2 className={i} strokeWidth={2} />, tono: 'bg-meta', titulo: <>{actor} cargó la factura <b>{datos.numero}</b>{datos.valor ? <> por {formatearCOP(datos.valor)}</> : null}</> };
    case 'factura_inactivada':
      return { icono: <FileX2 className={i} strokeWidth={2} />, tono: 'bg-meta', titulo: <>{actor} retiró la factura <b>{datos.numero}</b></> };
    case 'adjunto_agregado':
      return { icono: <Paperclip className={i} strokeWidth={2} />, tono: 'bg-meta',
        titulo: <>{actor} adjuntó {NOMBRE_TIPO_ADJUNTO[datos.tipo ?? '']?.toLowerCase() ?? 'un soporte'}: <b>{datos.nombre}</b></> };
    case 'adjunto_inactivado':
      return { icono: <FileX2 className={i} strokeWidth={2} />, tono: 'bg-meta', titulo: <>{actor} retiró un soporte ({NOMBRE_TIPO_ADJUNTO[datos.tipo ?? '']?.toLowerCase() ?? datos.tipo})</> };
    case 'comentario':
      return { icono: <MessageSquare className={i} strokeWidth={2} />, tono: 'bg-teal-vivo', titulo: <>{actor} comentó</>,
        cita: comentarios.get(Number(datos.comentario_id)) };
    default:
      return { icono: <Sparkles className={i} strokeWidth={2} />, tono: 'bg-meta', titulo: <>{actor}: {e.tipo}</> };
  }
}

/** Línea de tiempo del historial (solo inserción) con la conversación de la transacción. */
export function Historial({ d }: { d: Detalle }) {
  const [texto, setTexto] = useState('');
  const comentar = useAccionTransaccion(d.transaccion.id, () => api.post(`/transacciones/${d.transaccion.id}/comentarios`, { texto }));
  const comentarios = new Map(d.comentarios.map((c) => [c.id, c.texto]));
  const eventos = [...d.historial].reverse();

  return (
    <Tarjeta kicker="Trazabilidad" titulo="Historial">
      <form className="mb-6" onSubmit={(e) => { e.preventDefault(); comentar.mutate(undefined, { onSuccess: () => setTexto('') }); }}>
        <label htmlFor="comentario" className="sr-only">Escribe un comentario</label>
        <AreaTexto id="comentario" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe un comentario para el equipo…" className="min-h-[72px]" />
        {comentar.error && <div className="mt-2"><Alerta tono="error">{comentar.error.message}</Alerta></div>}
        <div className="mt-2 flex justify-end">
          <Boton type="submit" variante="secundario" disabled={!texto.trim()} cargando={comentar.isPending} icono={<MessageSquare className="h-[18px] w-[18px]" strokeWidth={2} />}>Comentar</Boton>
        </div>
      </form>

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
    </Tarjeta>
  );
}
