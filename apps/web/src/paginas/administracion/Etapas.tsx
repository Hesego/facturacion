import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { TIPOS_REFERENCIA, type RequisitosEtapa, type TipoReferencia } from '@gastos/shared';
import type { EquipoAdmin, EtapaAdmin } from '../../api/tipos';
import { ChipEtapa } from '../../componentes/marca';
import { Alerta, AreaTexto, Boton, Campo, Cargando, Chip, cx, Entrada, Seleccion } from '../../componentes/ui';
import { Casillas, DialogoFormulario, ErrorGuardado, Interruptor, useAdmin, useFormulario, useGuardar } from './comun';

const TIPO = { ejecucion: 'Ejecución', aprobacion: 'Aprobación', sistema: 'Sistema (cierre)' } as const;

interface FEtapa {
  codigo: string; nombre: string; descripcion: string; grupo: string; orden: number; tipo: keyof typeof TIPO; equipoId: string;
  slaDias: number; etapaDevolucionId: string; segregacion: boolean; activa: boolean; requisitos: RequisitosEtapa;
}
const requisitosVacios = (): RequisitosEtapa => ({ referencias: [], referencias_previas: [], adjuntos: [], comentario_obligatorio: false });

/** Editor de `requisitos`: lo que la etapa exige para poder avanzar. */
function EditorRequisitos({ r, cambiar }: { r: RequisitosEtapa; cambiar: (r: RequisitosEtapa) => void }) {
  const set = <K extends keyof RequisitosEtapa>(k: K, v: RequisitosEtapa[K]) => cambiar({ ...r, [k]: v });
  return (
    <div className="space-y-5 rounded-xl border-[1.5px] border-linea bg-papel/50 p-4">
      <p className="kicker">Requisitos para avanzar</p>
      <Campo etiqueta="Número que se registra en esta etapa" ayuda="Uno por etapa (p. ej. el número de RQ).">
        <div className="space-y-2">
          {r.referencias.map((ref, i) => (
            <div key={i} className="flex gap-2">
              <Seleccion className="w-28" value={ref.tipo} onChange={(e) => set('referencias', r.referencias.map((x, j) => j === i ? { ...x, tipo: e.target.value as TipoReferencia } : x))}>
                {TIPOS_REFERENCIA.map((t) => <option key={t}>{t}</option>)}
              </Seleccion>
              <Entrada value={ref.etiqueta} placeholder="Etiqueta, p. ej. Número de RQ" onChange={(e) => set('referencias', r.referencias.map((x, j) => j === i ? { ...x, etiqueta: e.target.value } : x))} />
              <button type="button" aria-label="Quitar" onClick={() => set('referencias', r.referencias.filter((_, j) => j !== i))} className="rounded-lg px-2 text-meta hover:text-rojo"><Trash2 className="h-[18px] w-[18px]" strokeWidth={2} /></button>
            </div>
          ))}
          <Boton type="button" variante="fantasma" onClick={() => set('referencias', [...r.referencias, { tipo: 'RQ', etiqueta: '' }])} icono={<Plus className="h-4 w-4" strokeWidth={2} />}>Agregar número</Boton>
        </div>
      </Campo>

      <Campo etiqueta="Números que ya deben existir (de etapas anteriores)">
        <Casillas valor={r.referencias_previas} alCambiar={(v) => set('referencias_previas', v)} opciones={TIPOS_REFERENCIA.map((t) => ({ valor: t, etiqueta: t }))} />
      </Campo>

      <Campo etiqueta="Archivos que se cargan en esta etapa" ayuda="Código en minúsculas (p. ej. evidencia_es), etiqueta visible y cantidad mínima.">
        <div className="space-y-2">
          {r.adjuntos.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_72px_auto] gap-2">
              <Entrada value={a.tipo} placeholder="codigo_tipo" onChange={(e) => set('adjuntos', r.adjuntos.map((x, j) => j === i ? { ...x, tipo: e.target.value } : x))} />
              <Entrada value={a.etiqueta} placeholder="Etiqueta" onChange={(e) => set('adjuntos', r.adjuntos.map((x, j) => j === i ? { ...x, etiqueta: e.target.value } : x))} />
              <Entrada type="number" min={0} value={a.min} aria-label="Mínimo" onChange={(e) => set('adjuntos', r.adjuntos.map((x, j) => j === i ? { ...x, min: Number(e.target.value) } : x))} />
              <button type="button" aria-label="Quitar" onClick={() => set('adjuntos', r.adjuntos.filter((_, j) => j !== i))} className="rounded-lg px-2 text-meta hover:text-rojo"><Trash2 className="h-[18px] w-[18px]" strokeWidth={2} /></button>
            </div>
          ))}
          <Boton type="button" variante="fantasma" onClick={() => set('adjuntos', [...r.adjuntos, { tipo: '', etiqueta: '', min: 1 }])} icono={<Plus className="h-4 w-4" strokeWidth={2} />}>Agregar archivo</Boton>
        </div>
      </Campo>

      <Campo etiqueta="Facturas mínimas" id="r-fmin" ayuda="Facturas activas que debe tener el gasto para completar esta etapa.">
        <Entrada id="r-fmin" type="number" min={0} className="max-w-[120px]" value={r.facturas?.min ?? 0}
          onChange={(e) => set('facturas', { min: Number(e.target.value) })} />
      </Campo>
      <Interruptor activo={r.comentario_obligatorio} alCambiar={(v) => set('comentario_obligatorio', v)} etiqueta="Comentario obligatorio al avanzar" ayuda="En aprobaciones es el comentario de la decisión." />
    </div>
  );
}

export function Etapas() {
  const { data, isLoading } = useAdmin<EtapaAdmin>('etapas');
  const { data: equipos } = useAdmin<EquipoAdmin>('equipos');
  const guardar = useGuardar();
  const ordenar = useGuardar();
  const form = useFormulario<FEtapa>({} as FEtapa);
  const { f, campo } = form;
  const [verInactivas, setVerInactivas] = useState(false);

  if (isLoading || !data) return <Cargando />;
  const activas = data.filter((e) => e.activa);
  const nombreEquipo = (id: number | null) => equipos?.find((q) => q.id === id)?.nombre ?? '—';
  const codigoDe = (id: number | null) => data.find((e) => e.id === id)?.codigo;

  const abrir = (e?: EtapaAdmin) => {
    guardar.reset();
    if (!e) {
      // Nueva etapa: justo antes del cierre, devolviendo a la anterior
      const antes = activas.filter((x) => x.tipo !== 'sistema').at(-1);
      form.abrir({ codigo: '', nombre: '', descripcion: '', grupo: '', orden: (antes?.orden ?? 0) + 5, tipo: 'ejecucion', equipoId: '',
        slaDias: 3, etapaDevolucionId: antes ? String(antes.id) : '', segregacion: false, activa: true, requisitos: requisitosVacios() }, null);
      return;
    }
    form.abrir({ codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion ?? '', grupo: e.grupo, orden: e.orden, tipo: e.tipo,
      equipoId: e.equipo_id ? String(e.equipo_id) : '', slaDias: e.sla_dias,
      etapaDevolucionId: e.etapa_devolucion_id ? String(e.etapa_devolucion_id) : '', segregacion: e.segregacion, activa: e.activa,
      requisitos: { ...requisitosVacios(), ...e.requisitos } }, e.id);
  };
  const enviar = () => {
    const cuerpo = { ...f, grupo: f.grupo || f.codigo, equipoId: f.equipoId ? Number(f.equipoId) : null, etapaDevolucionId: f.etapaDevolucionId ? Number(f.etapaDevolucionId) : null };
    guardar.mutate(form.id === null ? { metodo: 'post', ruta: 'etapas', cuerpo } : { metodo: 'put', ruta: `etapas/${form.id}`, cuerpo }, { onSuccess: form.cerrar });
  };
  const mover = (i: number, d: -1 | 1) => {
    const ids = activas.map((e) => e.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    ordenar.mutate({ metodo: 'post', ruta: 'etapas/orden', cuerpo: { ids } });
  };
  const lista = verInactivas ? data : activas;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="titular text-[26px]">Etapas del flujo</h2>
          <p className="mt-1 max-w-2xl text-secundario">
            El flujo sale de esta lista, no del código: un gasto avanza a la siguiente etapa activa según el orden. Los cambios aplican de inmediato a los gastos en curso.
          </p>
        </div>
        <div className="flex gap-3">
          <Boton variante="secundario" onClick={() => setVerInactivas((v) => !v)}>{verInactivas ? 'Ocultar inactivas' : 'Ver inactivas'}</Boton>
          <Boton onClick={() => abrir()} icono={<Plus className="h-[18px] w-[18px]" strokeWidth={2} />}>Nueva etapa</Boton>
        </div>
      </div>
      {ordenar.error && <div className="mb-4"><ErrorGuardado error={ordenar.error} /></div>}

      <ol className="space-y-3">
        {lista.map((e) => {
          const i = activas.findIndex((x) => x.id === e.id);
          return (
            <li key={e.id} className={cx('tarjeta flex flex-wrap items-center gap-4 px-4 py-3.5', !e.activa && 'opacity-60')}>
              <ChipEtapa codigo={e.codigo} tono={e.tipo === 'sistema' ? 'gris' : e.tipo === 'aprobacion' ? 'naranja' : 'teal'} />
              <div className="min-w-[220px] flex-1">
                <p className="font-bold">{e.nombre} <span className="font-normal text-meta">· orden {e.orden}{!e.activa && ' · inactiva'}</span></p>
                <p className="text-[14px] text-secundario">
                  {TIPO[e.tipo]}{e.equipo_id && <> · {nombreEquipo(e.equipo_id)}</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {e.tipo !== 'sistema' && <Chip>SLA {e.sla_dias} d</Chip>}
                {codigoDe(e.etapa_devolucion_id) && <Chip>Devuelve a {codigoDe(e.etapa_devolucion_id)}</Chip>}
                {e.segregacion && <Chip>Segregación</Chip>}
                {e.en_curso > 0 && <Chip tono="teal">{e.en_curso} en curso</Chip>}
              </div>
              <div className="flex items-center gap-1">
                {e.activa && <>
                  <button aria-label={`Subir ${e.codigo}`} disabled={i <= 0 || ordenar.isPending} onClick={() => mover(i, -1)} className="rounded-lg p-2 text-teal-profundo hover:bg-teal-profundo/10 disabled:opacity-30"><ArrowUp className="h-[18px] w-[18px]" strokeWidth={2} /></button>
                  <button aria-label={`Bajar ${e.codigo}`} disabled={i >= activas.length - 1 || ordenar.isPending} onClick={() => mover(i, 1)} className="rounded-lg p-2 text-teal-profundo hover:bg-teal-profundo/10 disabled:opacity-30"><ArrowDown className="h-[18px] w-[18px]" strokeWidth={2} /></button>
                </>}
                <button aria-label={`Editar ${e.codigo}`} onClick={() => abrir(e)} className="rounded-lg p-2 text-teal-profundo hover:bg-teal-profundo/10"><Pencil className="h-[18px] w-[18px]" strokeWidth={2} /></button>
              </div>
            </li>
          );
        })}
      </ol>

      {form.abierto && (
        <DialogoFormulario abierto alCerrar={form.cerrar} kicker="Administración · Etapas" titulo={form.id === null ? 'Nueva etapa' : `Editar ${f.codigo}`}
          alGuardar={enviar} cargando={guardar.isPending} error={guardar.error}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Código" id="et-codigo" requerido><Entrada id="et-codigo" value={f.codigo} onChange={(e) => campo('codigo', e.target.value.toUpperCase())} placeholder="VB" /></Campo>
            <Campo etiqueta="Grupo" id="et-grupo" ayuda="Agrupa subetapas (PG)"><Entrada id="et-grupo" value={f.grupo} onChange={(e) => campo('grupo', e.target.value.toUpperCase())} placeholder={f.codigo} /></Campo>
            <Campo etiqueta="Orden" id="et-orden" requerido><Entrada id="et-orden" type="number" min={1} value={f.orden} onChange={(e) => campo('orden', Number(e.target.value))} /></Campo>
          </div>
          <Campo etiqueta="Nombre" id="et-nombre" requerido><Entrada id="et-nombre" value={f.nombre} onChange={(e) => campo('nombre', e.target.value)} /></Campo>
          <Campo etiqueta="Descripción" id="et-desc" ayuda="Se muestra en el detalle de la transacción."><AreaTexto id="et-desc" value={f.descripcion} onChange={(e) => campo('descripcion', e.target.value)} /></Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Tipo" id="et-tipo">
              <Seleccion id="et-tipo" value={f.tipo} onChange={(e) => campo('tipo', e.target.value as FEtapa['tipo'])}>
                {Object.entries(TIPO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Equipo responsable" id="et-equipo" ayuda="Quien envía elige a una persona de este equipo.">
              <Seleccion id="et-equipo" value={f.equipoId} disabled={f.tipo === 'sistema'} onChange={(e) => campo('equipoId', e.target.value)}>
                <option value="">{f.tipo === 'sistema' ? 'La ejecuta el sistema' : 'Elige el equipo'}</option>
                {(equipos ?? []).filter((q) => q.activo).map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
              </Seleccion>
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Plazo (SLA) en días hábiles" id="et-sla" ayuda="Desde este día la etapa queda vencida (rojo)."><Entrada id="et-sla" type="number" min={1} max={60} value={f.slaDias} onChange={(e) => campo('slaDias', Number(e.target.value))} /></Campo>
            <Campo etiqueta="Devolver a" id="et-dev" ayuda="Solo etapas anteriores. Vacío: no admite devolución.">
              <Seleccion id="et-dev" value={f.etapaDevolucionId} onChange={(e) => campo('etapaDevolucionId', e.target.value)}>
                <option value="">No admite devolución</option>
                {activas.filter((x) => x.orden < f.orden && x.id !== form.id).map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
              </Seleccion>
            </Campo>
          </div>
          <Interruptor activo={f.segregacion} alCambiar={(v) => campo('segregacion', v)} etiqueta="Segregación de funciones"
            ayuda="Quien ejecutó la etapa anterior no puede avanzar esta." />
          {f.tipo !== 'sistema' && <EditorRequisitos r={f.requisitos} cambiar={(r) => campo('requisitos', r)} />}
          <Interruptor activo={f.activa} alCambiar={(v) => campo('activa', v)} etiqueta="Etapa activa" ayuda="No se puede desactivar mientras tenga gastos en curso." />
          {form.id !== null && <Alerta tono="aviso">Los cambios aplican de inmediato a los gastos que están en esta etapa.</Alerta>}
        </DialogoFormulario>
      )}
    </section>
  );
}
