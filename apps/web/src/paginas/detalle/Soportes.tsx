import { useState } from 'react';
import { Download, FileText, Image as Imagen, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/cliente';
import { useAccionTransaccion } from '../../api/consultas';
import type { Detalle } from '../../api/tipos';
import { CargaArchivos } from '../../componentes/CargaArchivo';
import { FormFactura } from '../../componentes/FormFactura';
import { BotonVer, useVisor, VisorArchivo } from '../../componentes/VisorArchivo';
import { Alerta, Boton, Chip, cx, Tarjeta, ZonaDesplazable } from '../../componentes/ui';
import { formatearCOP, formatearFecha, formatearFechaHora, formatearTamano } from '../../formato';

const descarga = (id: number) => `/api/adjuntos/${id}/descarga`;

export const NOMBRE_TIPO_ADJUNTO: Record<string, string> = {
  factura: 'Factura',
  factura_xml: 'Factura electrónica (XML/ZIP)',
  pantallazo_operacion: 'Pantallazo de la operación',
  documento_oc: 'Orden de compra',
  evidencia_es: 'Evidencia de la entrega',
  comprobante_pago: 'Comprobante de pago',
  soporte_adicional: 'Soporte adicional',
};

export function ListaAdjuntos({ d, adjuntos, puedeRetirar }: { d: Detalle; adjuntos: Detalle['adjuntos']; puedeRetirar?: boolean }) {
  const retirar = useAccionTransaccion(d.transaccion.id, (id: number) => api.post(`/adjuntos/${id}/inactivar`, { motivo: 'error_registro' }));
  const visor = useVisor();
  return (
    <>
      <VisorArchivo vista={visor.vista} alCerrar={visor.cerrar} />
      {retirar.error && <Alerta tono="error">{retirar.error.message}</Alerta>}
      <ul className="divide-y divide-linea rounded-xl border-[1.5px] border-linea">
        {adjuntos.map((a) => (
          <li key={a.id} className={cx('flex items-center gap-3 px-3.5 py-2.5', !a.activo && 'opacity-60')}>
            {a.mime.startsWith('image/') ? <Imagen className="h-5 w-5 shrink-0 text-teal-profundo" strokeWidth={2} /> : <FileText className="h-5 w-5 shrink-0 text-teal-profundo" strokeWidth={2} />}
            <div className="min-w-0 flex-1">
              <p className={cx('truncate text-[15px] font-bold', !a.activo && 'line-through')}>{a.nombre_original}</p>
              <p className="truncate text-[13px] text-meta">
                {NOMBRE_TIPO_ADJUNTO[a.tipo] ?? a.tipo} · {formatearTamano(a.tamano_bytes)} · {a.subido_por} · {formatearFechaHora(a.subido_en)}
                {!a.activo && ` · retirado (${a.inactivado_motivo === 'anulacion' ? 'anulación' : a.inactivado_motivo === 'reemplazo' ? 'reemplazo' : 'error de registro'})`}
              </p>
            </div>
            <BotonVer vista={{ nombre: a.nombre_original, mime: a.mime, adjuntoId: a.id }} alVer={visor.ver} />
            <a href={descarga(a.id)} className="rounded-lg p-1.5 text-teal-profundo hover:bg-teal-profundo/10" aria-label={`Descargar ${a.nombre_original}`} title="Descargar">
              <Download className="h-[18px] w-[18px]" strokeWidth={2} />
            </a>
            {puedeRetirar && a.activo && (
              <button onClick={() => retirar.mutate(a.id)} disabled={retirar.isPending} aria-label={`Retirar ${a.nombre_original}`} title="Retirar (queda en el historial)"
                className="rounded-lg p-1.5 text-meta hover:bg-rojo/10 hover:text-rojo">
                <Trash2 className="h-[18px] w-[18px]" strokeWidth={2} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function SeccionFacturas({ d }: { d: Detalle }) {
  const [agregando, setAgregando] = useState(false);
  const { transaccion: t, acciones } = d;
  const activas = d.facturas.filter((f) => f.activa);
  const agregar = useAccionTransaccion(t.id, ({ campos, archivos }: { campos: Record<string, string>; archivos: [string, File][] }) =>
    api.formulario(`/transacciones/${t.id}/facturas`, campos, archivos));
  const retirar = useAccionTransaccion(t.id, (id: number) => api.post(`/facturas/${id}/inactivar`, { motivo: 'error_registro' }));
  const visor = useVisor();
  const archivoDe = (id: number) => d.adjuntos.find((a) => a.id === id);
  /** «Ver PDF» / «Ver XML» en pantalla, y descarga aparte */
  const enlace = (id: number, texto: string) => {
    const a = archivoDe(id);
    return (
      <span className="inline-flex items-center">
        {a && <BotonVer vista={{ nombre: a.nombre_original, mime: a.mime, adjuntoId: id }} alVer={visor.ver} />}
        <a href={descarga(id)} title={`Descargar ${texto}`} aria-label={`Descargar ${texto}`}
          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-bold text-teal-profundo hover:bg-teal-profundo/10">
          <Download className="h-4 w-4" strokeWidth={2} /> {texto}
        </a>
      </span>
    );
  };

  return (
    <Tarjeta kicker={`${activas.length} activa${activas.length === 1 ? '' : 's'}`} titulo="Facturas"
      extra={acciones.registrarFacturas && !agregando && (
        <Boton variante="secundario" onClick={() => setAgregando(true)} icono={<Plus className="h-[18px] w-[18px]" strokeWidth={2} />}>Agregar</Boton>
      )}>
      <VisorArchivo vista={visor.vista} alCerrar={visor.cerrar} />
      {retirar.error && <div className="mb-3"><Alerta tono="error">{retirar.error.message}</Alerta></div>}
      {d.facturas.length === 0 ? <p className="text-secundario">Aún no hay facturas.</p> : (
        <ul className="divide-y divide-linea">
          {d.facturas.map((f) => (
            <li key={f.id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 py-3', !f.activa && 'text-meta')}>
              <FileText className="h-5 w-5 shrink-0 text-teal-profundo" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  <span className={cx(!f.activa && 'line-through')}>{f.numero}</span>
                  {!f.activa && <span className="ml-2"><Chip>{f.inactivada_motivo === 'anulacion' ? 'Liberada' : 'Retirada'}</Chip></span>}
                </p>
                <p className="text-[14px] text-meta">
                  {[f.proveedor_nombre, f.proveedor_nit && `NIT ${f.proveedor_nit}`, f.fecha && formatearFecha(f.fecha), `cargada por ${f.registrada_por}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              {f.valor && <p className="font-bold tabular-nums">{formatearCOP(f.valor)}</p>}
              <div className="flex items-center gap-1 text-[14px]">
                {enlace(f.adjunto_id, 'PDF')}
                {f.xml_adjunto_id && enlace(f.xml_adjunto_id, 'XML')}
                {f.activa && acciones.registrarFacturas && (
                  <button onClick={() => retirar.mutate(f.id)} aria-label={`Retirar factura ${f.numero}`} title="Retirar por error de registro"
                    className="rounded-lg p-1.5 text-meta hover:bg-rojo/10 hover:text-rojo"><Trash2 className="h-[18px] w-[18px]" strokeWidth={2} /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {agregando && (
        <div className="mt-4">
          <FormFactura alCancelar={() => setAgregando(false)}
            alGuardar={async (datos) => { await agregar.mutateAsync(datos); setAgregando(false); }} />
        </div>
      )}
    </Tarjeta>
  );
}

export function SeccionAdjuntos({ d }: { d: Detalle }) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [agregando, setAgregando] = useState(false);
  const subir = useAccionTransaccion(d.transaccion.id, (lista: File[]) =>
    api.formulario(`/transacciones/${d.transaccion.id}/adjuntos`, {}, lista.map((a): [string, File] => ['soporte', a])));
  const adjuntos = d.adjuntos.filter((a) => !a.tipo.startsWith('factura'));
  const porEtapa = new Map<string, { nombre: string; lista: Detalle['adjuntos'] }>();
  for (const a of adjuntos) {
    const g = porEtapa.get(a.etapa_codigo) ?? { nombre: a.etapa_nombre, lista: [] };
    g.lista.push(a);
    porEtapa.set(a.etapa_codigo, g);
  }
  return (
    <Tarjeta kicker="Por etapa" titulo="Soportes" llenar
      extra={d.acciones.adjuntar && !agregando && (
        <Boton variante="secundario" onClick={() => setAgregando(true)} icono={<Plus className="h-[18px] w-[18px]" strokeWidth={2} />}>Agregar</Boton>
      )}>
      {agregando && (
        <div className="mb-5 space-y-3 rounded-xl border-[1.5px] border-linea bg-papel/50 p-4">
          {subir.error && <Alerta tono="error">{subir.error.message}</Alerta>}
          <CargaArchivos archivos={archivos} alCambiar={setArchivos} texto="Arrastra pantallazos, fotos o PDF" textoOtro="Agregar otro" />
          <div className="flex justify-end gap-3">
            <Boton variante="fantasma" onClick={() => { setAgregando(false); setArchivos([]); }}>Cancelar</Boton>
            <Boton disabled={!archivos.length} cargando={subir.isPending}
              onClick={() => subir.mutate(archivos, { onSuccess: () => { setArchivos([]); setAgregando(false); } })}>
              {archivos.length > 1 ? `Subir ${archivos.length} soportes` : 'Subir soporte'}
            </Boton>
          </div>
        </div>
      )}
      {adjuntos.length === 0 ? <p className="text-secundario">Aún no hay soportes cargados.</p> : (
        <ZonaDesplazable etiqueta="Soportes de la transacción">
          <div className="space-y-5">
            {[...porEtapa.entries()].map(([codigo, g]) => (
              <div key={codigo}>
                <p className="mb-2 font-etiqueta text-[13px] font-bold uppercase tracking-chip text-teal-profundo">{codigo} · {g.nombre}</p>
                <ListaAdjuntos d={d} adjuntos={g.lista} />
              </div>
            ))}
          </div>
        </ZonaDesplazable>
      )}
    </Tarjeta>
  );
}
