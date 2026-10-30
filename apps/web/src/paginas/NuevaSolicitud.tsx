import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Send } from 'lucide-react';
import { normalizarValor } from '@gastos/shared';
import { api, ErrorApi } from '../api/cliente';
import { useCatalogos, useYo } from '../api/consultas';
import type { Transaccion } from '../api/tipos';
import { CargaArchivos } from '../componentes/CargaArchivo';
import { destinoIncompleto, destinoVacio, SelectorDestino, type Destino } from '../componentes/SelectorDestino';
import { archivosFacturas, faltaEnFila, SelectorFacturas, type FilaFactura } from '../componentes/SelectorFacturas';
import { Alerta, AreaTexto, Boton, Campo, Cargando, EncabezadoPagina, Entrada, Seleccion, Tarjeta } from '../componentes/ui';
import { formatearCOP } from '../formato';
import { NoEncontrada } from './NoEncontrada';

/** Solo lo necesario para el control: las facturas, sus números y a quién se envía. */
export function NuevaSolicitud() {
  const { data: yo } = useYo();
  const { data: cat, isLoading } = useCatalogos();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [facturas, setFacturas] = useState<FilaFactura[]>([]);
  const [soportes, setSoportes] = useState<File[]>([]);
  const [para, setPara] = useState<Destino>(destinoVacio);
  const [valor, setValor] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [comentario, setComentario] = useState('');
  const [mas, setMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [intentado, setIntentado] = useState(false);

  if (yo && !yo.equipos.includes('contabilidad')) return <NoEncontrada mensaje="Solo contabilidad crea solicitudes de gasto." />;
  if (isLoading || !cat) return <Cargando />;

  const siguiente = cat.etapas[1];
  const persona = siguiente?.miembros.find((m) => String(m.id) === para.usuarioId);
  const valorNormal = normalizarValor(valor);
  const facturasIncompletas = !facturas.length || facturas.some((f) => faltaEnFila(f));

  const enviar = async () => {
    setIntentado(true);
    setError(null);
    if (facturasIncompletas || !siguiente || destinoIncompleto(para, siguiente.areas)) return;
    setEnviando(true);
    try {
      const { archivos, campos } = archivosFacturas(facturas);
      const t = await api.formulario<Transaccion>('/transacciones',
        { ...campos, asignarA: para.usuarioId, areaId: para.areaId, valor: valorNormal, descripcion: descripcion.trim(), comentario: comentario.trim() },
        [...archivos, ...soportes.map((s): [string, File] => ['soporte', s])]);
      await qc.invalidateQueries();
      navegar(`/transacciones/${t.id}`, { state: { aviso: 'enviada', para: persona?.nombre } });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No fue posible crear la solicitud');
      setEnviando(false);
    }
  };

  return (
    <>
      <EncabezadoPagina kicker="SOL · Solicitud de gasto" titulo={<>Nueva <span className="text-teal-profundo">solicitud</span></>}>
        Sube las facturas, revisa sus números y elige a quién se las envías. El resto lo valida el sistema.
      </EncabezadoPagina>

      <Tarjeta className="max-w-2xl">
        <div className="space-y-6">
          <Campo etiqueta={facturas.length > 1 ? `Facturas (${facturas.length})` : 'Facturas'} requerido
            error={intentado && !facturas.length ? 'Adjunta al menos una factura' : undefined}
            ayuda="Puedes subir varias de una vez. Si tienes el ZIP o el XML de la DIAN, súbelo también: el número, el NIT y el valor se leen solos.">
            <SelectorFacturas filas={facturas} alCambiar={setFacturas} intentado={intentado}
              alSoportes={(imagenes) => setSoportes((s) => [...s, ...imagenes.filter((i) => !s.some((x) => x.name === i.name && x.size === i.size))])} />
          </Campo>

          <Campo etiqueta="Otros soportes (opcional)" ayuda="Pantallazos, fotos o PDF que acompañan la solicitud. Si arrastras imágenes junto con las facturas, quedan aquí.">
            <CargaArchivos archivos={soportes} alCambiar={setSoportes} texto="Arrastra pantallazos, fotos o PDF" textoOtro="Agregar otro soporte" />
          </Campo>

          {siguiente && (
            <SelectorDestino etiqueta={`Enviar a · ${siguiente.nombre}`} areas={siguiente.areas} miembros={siguiente.miembros}
              valor={para} alCambiar={setPara} intentado={intentado} />
          )}

          <div>
            <button type="button" onClick={() => setMas((v) => !v)} aria-expanded={mas}
              className="flex items-center gap-1.5 font-etiqueta text-[14px] font-bold uppercase tracking-chip text-teal-profundo">
              <ChevronDown className={`h-4 w-4 transition-transform ${mas ? 'rotate-180' : ''}`} strokeWidth={2} /> Más datos (opcional)
            </button>
            {mas && (
              <div className="mt-4 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Campo etiqueta="Valor" id="valor" ayuda={/^\d+(\.\d{1,2})?$/.test(valorNormal) && Number(valorNormal) > 0 ? formatearCOP(valorNormal) : 'Si vienen los XML, es la suma de las facturas'}>
                    <Entrada id="valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="1.500.000" />
                  </Campo>
                  <Campo etiqueta="Descripción corta" id="descripcion" ayuda="Para reconocerla en las listas">
                    <Entrada id="descripcion" maxLength={200} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Botas dieléctricas cuadrilla Jamundí" />
                  </Campo>
                </div>
                <Campo etiqueta="Comentario para quien la recibe" id="comentario">
                  <AreaTexto id="comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} className="min-h-[72px]" />
                </Campo>
              </div>
            )}
          </div>

          {error && <Alerta tono="error">{error}</Alerta>}
          <Boton tamano="grande" className="w-full sm:w-auto" onClick={enviar} cargando={enviando} icono={<Send className="h-5 w-5" strokeWidth={2} />}>
            {persona ? `Enviar a ${persona.nombre.split(' ')[0]}` : 'Enviar'}
          </Boton>
        </div>
      </Tarjeta>
    </>
  );
}
