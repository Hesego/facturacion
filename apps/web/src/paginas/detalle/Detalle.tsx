import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { MessageSquare, X } from 'lucide-react';
import { ErrorApi } from '../../api/cliente';
import { useDetalle } from '../../api/consultas';
import { Semaforo } from '../../componentes/marca';
import { Alerta, Cargando, Chip, DatoEtiquetado, EncabezadoPagina, Tarjeta } from '../../componentes/ui';
import { formatearCOP, formatearFechaHora } from '../../formato';
import { NoEncontrada } from '../NoEncontrada';
import { Historial } from './Historial';
import { PanelEtapa } from './PanelEtapa';
import { ProgresoFlujo } from './ProgresoFlujo';
import { SeccionAdjuntos, SeccionFacturas } from './Soportes';


/**
 * Lo que dejó escrito quien envió, devolvió o reasignó la transacción por última vez: es lo primero
 * que ve la persona que la recibe (trazabilidad entre actores).
 */
function UltimaObservacion({ historial }: { historial: { tipo: string; motivo: string | null; datos: Record<string, unknown>; ocurrido_en: string; actor: string | null; origen_nombre: string | null }[] }) {
  const ultimo = [...historial].reverse().find((e) => ['avanzada', 'devuelta', 'reasignada'].includes(e.tipo));
  const texto = ultimo && (ultimo.motivo ?? (ultimo.datos.comentario as string | null | undefined));
  if (!ultimo || !texto) return null;
  const accion = ultimo.tipo === 'devuelta' ? 'Motivo de la devolución' : ultimo.tipo === 'reasignada' ? 'Motivo de la reasignación' : 'Observación';
  return (
    <Tarjeta acento="naranja" kicker={`${accion} · ${ultimo.actor ?? 'El sistema'}`}>
      <div className="flex items-start gap-3">
        <MessageSquare className="mt-1 h-5 w-5 shrink-0 text-teal-profundo" strokeWidth={2} />
        <div className="min-w-0">
          <p className="whitespace-pre-line text-[17px] text-tinta">{texto}</p>
          <p className="mt-2 text-[14px] text-meta">{ultimo.origen_nombre ? `${ultimo.origen_nombre} · ` : ''}{formatearFechaHora(ultimo.ocurrido_en)} · Las anteriores están en el historial.</p>
        </div>
      </div>
    </Tarjeta>
  );
}

export function Detalle() {
  const id = Number(useParams().id);
  const estado = useLocation().state as { aviso?: string; para?: string } | null;
  const { data: d, isLoading, error } = useDetalle(id);
  const [aviso, setAviso] = useState<string | null>(estado?.aviso === 'enviada' ? `Solicitud creada y enviada a ${estado.para ?? 'operaciones'}. Le avisamos por correo.` : null);
  useEffect(() => { if (aviso) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [aviso]);

  if (isLoading) return <Cargando />;
  if (error instanceof ErrorApi && error.codigo === 'NO_ENCONTRADA') return <NoEncontrada mensaje="Esta transacción no existe." />;
  if (error || !d) return <Alerta tono="error">{error?.message ?? 'No fue posible cargar la transacción'}</Alerta>;
  const t = d.transaccion;
  const referencias = d.referencias.filter((r) => r.activa);
  const facturas = d.facturas.filter((f) => f.activa).map((f) => f.numero).join(', ');
  const proveedor = d.facturas.find((f) => f.activa && f.proveedor_nombre)?.proveedor_nombre;

  return (
    <>
      <EncabezadoPagina kicker={`Transacción · Factura ${facturas || '—'}`} titulo={t.consecutivo}
        acciones={<>
          {t.estado === 'en_curso' && t.semaforo && <Semaforo semaforo={t.semaforo} dias={t.dias_habiles_en_etapa ?? 0} />}
          {t.estado === 'pagada' && <Chip tono="verde">Pagada</Chip>}
          {t.estado === 'anulada' && <Chip tono="rojo">Anulada</Chip>}
        </>}>
        {t.descripcion ?? undefined}
      </EncabezadoPagina>

      {aviso && (
        <div className="mb-6 flex items-start gap-2">
          <div className="flex-1"><Alerta tono="exito">{aviso}</Alerta></div>
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="mt-2 rounded-lg p-1.5 text-meta hover:bg-white"><X className="h-4 w-4" strokeWidth={2} /></button>
        </div>
      )}

      <Tarjeta acento="ninguno" className="mb-6"><ProgresoFlujo d={d} /></Tarjeta>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {t.estado === 'en_curso' && <UltimaObservacion historial={d.historial} />}
          <PanelEtapa d={d} alAvisar={setAviso} />
          <SeccionFacturas d={d} />
          <SeccionAdjuntos d={d} />
        </div>
        <div className="space-y-6">
          <Tarjeta kicker="Datos del gasto">
            {t.valor ? (
              <>
                <p className="cifra text-[44px] text-teal-profundo">{formatearCOP(t.valor)}</p>
                <p className="mb-6 mt-1.5 font-etiqueta text-[13px] font-bold uppercase tracking-kicker">Valor del gasto · COP</p>
              </>
            ) : null}
            <dl className="grid gap-4">
              <DatoEtiquetado etiqueta="Factura">{facturas || '—'}{proveedor && <span className="block text-[14px] text-meta">{proveedor}</span>}</DatoEtiquetado>
              {t.estado === 'en_curso' && (
                <DatoEtiquetado etiqueta="A cargo de">{t.asignado?.nombre ?? '—'}{t.area && <span className="block text-[14px] text-meta">Área: {t.area.nombre}</span>}</DatoEtiquetado>
              )}
              <DatoEtiquetado etiqueta="Solicitante">{t.solicitante?.nombre ?? '—'}</DatoEtiquetado>
              <DatoEtiquetado etiqueta="Creada">{formatearFechaHora(t.creado_en)}</DatoEtiquetado>
              {t.estado === 'en_curso'
                ? <DatoEtiquetado etiqueta="En la etapa desde">{formatearFechaHora(t.en_etapa_desde)}</DatoEtiquetado>
                : t.cerrado_en && <DatoEtiquetado etiqueta={t.estado === 'pagada' ? 'Pagada' : 'Anulada'}>{formatearFechaHora(t.cerrado_en)}</DatoEtiquetado>}
              {referencias.length > 0 && (
                <DatoEtiquetado etiqueta="Números">
                  <span className="mt-1 flex flex-wrap gap-2">{referencias.map((r) => <Chip key={r.id}>{r.tipo} {r.numero}</Chip>)}</span>
                </DatoEtiquetado>
              )}
            </dl>
          </Tarjeta>
          <Historial d={d} />
        </div>
      </div>
    </>
  );
}
