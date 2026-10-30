import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, CornerUpLeft, Hash, Lock, Send, UserRoundCog } from 'lucide-react';
import { api, ErrorApi } from '../../api/cliente';
import { useAccionTransaccion } from '../../api/consultas';
import type { Detalle } from '../../api/tipos';
import { CargaArchivos } from '../../componentes/CargaArchivo';
import { Dialogo } from '../../componentes/Dialogo';
import { ChipEtapa } from '../../componentes/marca';
import { Alerta, AreaTexto, Boton, Campo, Entrada, Seleccion, Tarjeta } from '../../componentes/ui';
import { destinoIncompleto, destinoVacio, SelectorDestino, type Destino } from '../../componentes/SelectorDestino';
import { ListaAdjuntos } from './Soportes';

type TipoDialogo = 'devolver' | 'anular' | 'reasignar' | null;
const primerNombre = (n?: string | null) => n?.split(' ')[0] ?? '';

/** La etapa actual en un solo formulario: número, documento, a quién se envía y comentario. */
export function PanelEtapa({ d, alAvisar }: { d: Detalle; alAvisar: (texto: string) => void }) {
  const { transaccion: t, etapa, acciones, requisitos, siguiente } = d;
  const refActual = d.referencias.find((r) => r.activa && r.tipo === etapa.referencia?.tipo)?.numero ?? '';
  const documentoListo = etapa.documentos.every((doc) => requisitos.find((r) => r.clave === `adjunto:${doc.tipo}`)?.cumple);
  const [numero, setNumero] = useState(refActual);
  const [documentos, setDocumentos] = useState<File[]>([]);
  const [soportes, setSoportes] = useState<File[]>([]);
  const [para, setPara] = useState<Destino>(destinoVacio);
  const [comentario, setComentario] = useState('');
  const [intentado, setIntentado] = useState(false);
  const [dialogo, setDialogo] = useState<TipoDialogo>(null);
  const [texto, setTexto] = useState('');
  const [reasignarA, setReasignarA] = useState<Destino>(destinoVacio);
  useEffect(() => { setNumero(refActual); setDocumentos([]); setSoportes([]); setPara(destinoVacio); setComentario(''); setIntentado(false); }, [t.version, refActual]);

  const avanzar = useAccionTransaccion(t.id, () => api.formulario(`/transacciones/${t.id}/avanzar`,
    { version: t.version, numero: etapa.referencia ? numero.trim() : undefined, asignarA: para.usuarioId || undefined, areaId: para.areaId || undefined, comentario: comentario.trim() },
    [...documentos.map((a): [string, File] => ['documento', a]), ...soportes.map((a): [string, File] => ['soporte', a])]));
  const accion = useAccionTransaccion(t.id, ({ tipo, cuerpo }: { tipo: Exclude<TipoDialogo, null>; cuerpo: object }) =>
    api.post(`/transacciones/${t.id}/${tipo}`, { version: t.version, ...cuerpo }));

  if (t.estado !== 'en_curso') {
    return (
      <Tarjeta acento={t.estado === 'pagada' ? 'teal' : 'naranja'}>
        <div className="flex items-center gap-4">
          {t.estado === 'pagada' ? <CheckCircle2 className="h-10 w-10 shrink-0 text-verde" strokeWidth={2} /> : <Ban className="h-10 w-10 shrink-0 text-rojo" strokeWidth={2} />}
          <div>
            <p className="titular text-[26px]">{t.estado === 'pagada' ? 'Pagada y cerrada' : 'Anulada'}</p>
            <p className="text-secundario">{t.estado === 'pagada' ? 'El ciclo terminó y avisamos a todos los participantes.' : 'La transacción no admite más cambios. Sus facturas y números quedaron liberados.'}</p>
          </div>
        </div>
      </Tarjeta>
    );
  }

  const esAprobacion = etapa.tipo === 'aprobacion';
  const cierra = siguiente?.tipo === 'sistema';
  const persona = acciones.destino.miembros.find((p) => String(p.id) === para.usuarioId);
  const faltaNumero = !!etapa.referencia && !numero.trim();
  const faltaDocumento = etapa.documentos.length > 0 && !documentoListo && !documentos.length;
  const faltaPara = !cierra && destinoIncompleto(para, acciones.destino.areas);
  const faltaComentario = acciones.comentarioObligatorio && comentario.trim().length < 3;
  // Lo que no se llena en este formulario (números de etapas anteriores, facturas)
  const pendientesOtros = requisitos.filter((r) => !r.cumple && (r.clave.startsWith('referencia_previa:') || r.clave.startsWith('facturas:')));
  const adjuntosEtapa = d.adjuntos.filter((a) => a.etapa_codigo === etapa.codigo && a.activo && !a.tipo.startsWith('factura'));

  const enviar = () => {
    setIntentado(true);
    if (faltaNumero || faltaDocumento || faltaPara || faltaComentario) return;
    avanzar.mutate(undefined, {
      onSuccess: () => alAvisar(cierra ? 'Pago registrado: la transacción quedó cerrada y avisamos a todos los participantes.'
        : `Listo: ${esAprobacion ? 'aprobaste y ' : ''}la enviaste a ${persona?.nombre ?? siguiente?.nombre}. Le avisamos por correo.`),
    });
  };
  const textoBoton = cierra ? 'Registrar y cerrar'
    : `${esAprobacion ? 'Aprobar y enviar' : 'Enviar'}${persona ? ` a ${primerNombre(persona.nombre)}` : ''}`;

  const abrir = (dg: TipoDialogo) => { setTexto(''); setReasignarA(destinoVacio); accion.reset(); setDialogo(dg); };
  const confirmar = () => {
    if (!dialogo) return;
    const cuerpo = dialogo === 'reasignar'
      ? { usuarioId: Number(reasignarA.usuarioId), areaId: reasignarA.areaId ? Number(reasignarA.areaId) : undefined, motivo: texto.trim() || undefined }
      : { motivo: texto.trim() };
    accion.mutate({ tipo: dialogo, cuerpo }, {
      onSuccess: () => {
        setDialogo(null);
        alAvisar(dialogo === 'devolver' ? `La transacción volvió a ${acciones.devolverA?.persona ?? 'la etapa anterior'} con tu motivo.`
          : dialogo === 'reasignar' ? `Listo: ahora la tiene ${acciones.reasignacion.miembros.find((p) => String(p.id) === reasignarA.usuarioId)?.nombre ?? 'otra persona'}.` : 'La transacción quedó anulada.');
      },
    });
  };
  const errorDialogo = accion.error as ErrorApi | null;
  const dialogoValido = dialogo === 'reasignar' ? !destinoIncompleto(reasignarA, acciones.reasignacion.areas) : texto.trim().length >= 5;

  return (
    <Tarjeta acento="naranja">
      <div className="flex items-start gap-4">
        <ChipEtapa codigo={etapa.codigo} tamano="grande" tono="naranja" />
        <div className="min-w-0 flex-1">
          <p className="kicker text-naranja-profundo">Etapa actual{esAprobacion ? ' · Aprobación' : ''}</p>
          <h2 className="titular mt-1.5 text-[28px]">{etapa.nombre}</h2>
          <p className="mt-1.5 text-secundario">A cargo de <b className="text-tinta">{t.asignado?.nombre ?? '—'}</b></p>
        </div>
      </div>

      {acciones.bloqueoSegregacion && <div className="mt-5"><Alerta tono="aviso" titulo="Segregación de funciones">{acciones.bloqueoSegregacion}</Alerta></div>}

      {acciones.avanzar ? (
        <div className="mt-6 space-y-5 border-t border-linea pt-6">
          {pendientesOtros.length > 0 && (
            <Alerta tono="aviso" titulo="Antes de enviar falta">
              <ul className="list-disc pl-5">{pendientesOtros.map((r) => <li key={r.clave}>{r.descripcion}{r.detalle ? ` (${r.detalle})` : ''}</li>)}</ul>
            </Alerta>
          )}
          {etapa.referencia && (
            <Campo etiqueta={etapa.referencia.etiqueta} id="numero-etapa" requerido error={intentado && faltaNumero ? 'Escribe el número' : undefined}>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-meta" strokeWidth={2} />
                <Entrada id="numero-etapa" className="pl-10" value={numero} onChange={(e) => setNumero(e.target.value)} invalido={intentado && faltaNumero} />
              </div>
            </Campo>
          )}
          {etapa.documentos.map((doc) => (
            <Campo key={doc.tipo} etiqueta={doc.etiqueta} requerido={!documentoListo}
              ayuda={documentoListo ? 'Ya está cargado. Puedes subir más si hace falta.' : 'Puedes subir varios archivos.'}
              error={intentado && faltaDocumento ? 'Adjunta el documento' : undefined}>
              <CargaArchivos archivos={documentos} alCambiar={setDocumentos} invalido={intentado && faltaDocumento}
                texto="Arrastra el archivo o haz clic para elegirlo" textoOtro="Agregar otro archivo" />
            </Campo>
          ))}
          <Campo etiqueta="Otros soportes (opcional)" ayuda="Pantallazos, fotos o PDF adicionales.">
            <CargaArchivos archivos={soportes} alCambiar={setSoportes} texto="Arrastra pantallazos, fotos o PDF" textoOtro="Agregar otro soporte" />
          </Campo>
          {adjuntosEtapa.length > 0 && <ListaAdjuntos d={d} adjuntos={adjuntosEtapa} puedeRetirar />}
          {!cierra && siguiente && (
            <SelectorDestino etiqueta={`Enviar a · ${siguiente.nombre}`} areas={acciones.destino.areas} miembros={acciones.destino.miembros}
              valor={para} alCambiar={setPara} intentado={intentado} />
          )}
          <Campo etiqueta={esAprobacion ? 'Comentario de la aprobación' : 'Tu observación para quien la recibe'} id="comentario" requerido={acciones.comentarioObligatorio}
            error={intentado && faltaComentario ? 'Escribe tu observación' : undefined}
            ayuda={cierra ? 'Queda en el historial de la transacción.' : 'Le llega en el correo y la ve al abrir la tarea. Queda en el historial.'}>
            <AreaTexto id="comentario" className="min-h-[72px]" value={comentario} onChange={(e) => setComentario(e.target.value)} invalido={intentado && faltaComentario} />
          </Campo>
          {avanzar.error && <Alerta tono="error">{(avanzar.error as ErrorApi).message}</Alerta>}
          <div className="flex flex-wrap gap-3">
            <Boton tamano="grande" onClick={enviar} cargando={avanzar.isPending} icono={<Send className="h-5 w-5" strokeWidth={2} />}>{textoBoton}</Boton>
            {acciones.devolver && (
              <Boton tamano="grande" variante="secundario" onClick={() => abrir('devolver')} icono={<CornerUpLeft className="h-5 w-5" strokeWidth={2} />}>{acciones.etiquetaDevolver}</Boton>
            )}
          </div>
        </div>
      ) : !acciones.bloqueoSegregacion && (
        <p className="mt-5 flex items-center gap-2 text-secundario">
          <Lock className="h-[18px] w-[18px] shrink-0 text-meta" strokeWidth={2} /> La atiende {t.asignado?.nombre ?? 'otra persona'}. Puedes consultar y comentar.
        </p>
      )}

      {(acciones.reasignar || acciones.anular) && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-linea pt-4">
          {acciones.reasignar && <Boton variante="fantasma" onClick={() => abrir('reasignar')} icono={<UserRoundCog className="h-[18px] w-[18px]" strokeWidth={2} />}>Reasignar</Boton>}
          {acciones.anular && <Boton variante="fantasma" className="text-rojo hover:bg-rojo/10 sm:ml-auto" onClick={() => abrir('anular')} icono={<Ban className="h-[18px] w-[18px]" strokeWidth={2} />}>Anular</Boton>}
        </div>
      )}

      <Dialogo abierto={dialogo !== null} alCerrar={() => setDialogo(null)} kicker={`${t.consecutivo} · ${etapa.codigo}`}
        titulo={dialogo === 'reasignar' ? 'Reasignar' : dialogo === 'devolver' ? acciones.etiquetaDevolver : 'Anular la transacción'}
        pie={<>
          <Boton variante="fantasma" onClick={() => setDialogo(null)}>Cancelar</Boton>
          <Boton variante={dialogo === 'anular' ? 'peligro' : dialogo === 'devolver' ? 'accion' : 'primario'} onClick={confirmar} cargando={accion.isPending} disabled={!dialogoValido}>
            {dialogo === 'reasignar' ? 'Reasignar' : dialogo === 'devolver' ? acciones.etiquetaDevolver : 'Anular definitivamente'}
          </Boton>
        </>}>
        <div className="space-y-4">
          {errorDialogo && <Alerta tono="error">{errorDialogo.message}</Alerta>}
          {dialogo === 'devolver' && acciones.devolverA && (
            <p className="text-secundario">Volverá a <b className="text-tinta">{acciones.devolverA.persona ?? 'la etapa anterior'}</b> ({acciones.devolverA.etapa}) con tu motivo.</p>
          )}
          {dialogo === 'anular' && <Alerta tono="aviso" titulo="Esta acción no se puede deshacer">La transacción se cierra como anulada y sus facturas quedan libres para registrarse en otra.</Alerta>}
          {dialogo === 'reasignar' && (
            <>
              <SelectorDestino etiqueta="Pasar a" areas={acciones.reasignacion.areas} miembros={acciones.reasignacion.miembros}
                valor={reasignarA} alCambiar={setReasignarA} />
              <p className="text-[14px] text-meta">El plazo de la etapa no se reinicia.</p>
            </>
          )}
          <Campo etiqueta={dialogo === 'reasignar' ? 'Motivo' : 'Motivo'} id="texto-dialogo" requerido={dialogo !== 'reasignar'}
            ayuda={dialogo === 'reasignar' ? 'Opcional, p. ej. «Vacaciones»' : 'Mínimo 5 caracteres. Queda en el historial.'}>
            <AreaTexto id="texto-dialogo" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus={dialogo !== 'reasignar'}
              placeholder={dialogo === 'devolver' ? 'Explica qué hay que corregir' : undefined} />
          </Campo>
          {dialogo === 'devolver' && <p className="flex items-center gap-2 text-[14px] text-meta"><AlertTriangle className="h-4 w-4" strokeWidth={2} /> Queda registrado con tu nombre, fecha y hora.</p>}
        </div>
      </Dialogo>
    </Tarjeta>
  );
}
