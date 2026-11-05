import { useState } from 'react';
import { Save } from 'lucide-react';
import type { ConfigAdmin, EquipoAdmin } from '../../api/tipos';
import { Boton, Campo, Cargando, Chip, Entrada, Tarjeta } from '../../componentes/ui';
import { Casillas, ErrorGuardado, useAdmin, useGuardar } from './comun';

const TITULOS: Record<string, string> = {
  semaforo: 'Semáforo de SLA',
  escalamiento_dias_despues_de_vencer: 'Escalamiento al líder',
  consecutivo_prefijo: 'Prefijo del consecutivo',
  adjuntos_tamano_max_mb: 'Tamaño máximo de archivos (MB)',
  equipos_pueden_anular: 'Quién puede anular',
  equipos_gestionan_facturas: 'Quién registra facturas',
  equipos_pueden_reasignar: 'Quién puede reasignar',
};

function Editor({ c, equipos }: { c: ConfigAdmin; equipos: EquipoAdmin[] }) {
  const [valor, setValor] = useState<unknown>(c.valor);
  const guardar = useGuardar();
  const cambiado = JSON.stringify(valor) !== JSON.stringify(c.valor);
  const numero = (v: string) => (v === '' ? '' : Number(v));

  let editor;
  if (c.clave === 'semaforo') {
    const s = valor as { amarillo: number; naranja: number };
    editor = (
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Amarillo desde (días hábiles)" id={`${c.clave}-a`}><Entrada id={`${c.clave}-a`} type="number" min={0} value={s.amarillo} onChange={(e) => setValor({ ...s, amarillo: numero(e.target.value) })} /></Campo>
        <Campo etiqueta="Naranja desde (días hábiles)" id={`${c.clave}-n`}><Entrada id={`${c.clave}-n`} type="number" min={1} value={s.naranja} onChange={(e) => setValor({ ...s, naranja: numero(e.target.value) })} /></Campo>
      </div>
    );
  } else if (Array.isArray(c.valor)) {
    editor = <Casillas valor={valor as string[]} alCambiar={setValor} opciones={equipos.filter((e) => e.activo).map((e) => ({ valor: e.codigo, etiqueta: e.nombre }))} />;
  } else if (typeof c.valor === 'number') {
    editor = <Entrada type="number" className="max-w-[160px]" aria-label={TITULOS[c.clave]} value={valor as number} onChange={(e) => setValor(numero(e.target.value))} />;
  } else {
    editor = <Entrada className="max-w-[200px]" aria-label={TITULOS[c.clave]} value={String(valor)} onChange={(e) => setValor(e.target.value.toUpperCase())} />;
  }

  return (
    <Tarjeta acento="ninguno" kicker={c.clave} titulo={TITULOS[c.clave] ?? c.clave}>
      <p className="mb-4 text-secundario">{c.descripcion}</p>
      {editor}
      <div className="mt-4 flex items-center gap-3">
        <Boton variante="secundario" disabled={!cambiado} cargando={guardar.isPending} icono={<Save className="h-[18px] w-[18px]" strokeWidth={2} />}
          onClick={() => guardar.mutate({ metodo: 'put', ruta: `configuracion/${c.clave}`, cuerpo: { valor } })}>Guardar</Boton>
        {guardar.isSuccess && !cambiado && <span className="text-[14px] text-meta" role="status">Guardado</span>}
      </div>
      {guardar.error && <div className="mt-3"><ErrorGuardado error={guardar.error} /></div>}
    </Tarjeta>
  );
}

export function Configuracion() {
  const { data, isLoading } = useAdmin<ConfigAdmin>('configuracion');
  const { data: equipos } = useAdmin<EquipoAdmin>('equipos');
  if (isLoading || !data || !equipos) return <Cargando />;
  const fijas = data.filter((c) => !c.editable);
  return (
    <section>
      <h2 className="titular text-[26px]">Configuración</h2>
      <p className="mb-5 mt-1 max-w-2xl text-secundario">Reglas generales del proceso. El plazo de cada etapa (rojo) se define en la etapa.</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {data.filter((c) => c.editable).map((c) => <Editor key={c.clave} c={c} equipos={equipos} />)}
      </div>
      <Tarjeta acento="ninguno" kicker="Solo lectura" titulo="Valores fijos" className="mt-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          {fijas.map((c) => (
            <div key={c.clave}>
              <dt className="font-mono text-[13px] text-meta">{c.clave}</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">{(Array.isArray(c.valor) ? c.valor : [c.valor]).map((v) => <Chip key={String(v)}>{String(v)}</Chip>)}</dd>
            </div>
          ))}
        </dl>
      </Tarjeta>
    </section>
  );
}
