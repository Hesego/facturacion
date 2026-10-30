import { useEffect, useId } from 'react';
import type { AreaConMiembros, Persona } from '../api/tipos';
import { Campo, Seleccion } from './ui';

export interface Destino {
  areaId: string;
  usuarioId: string;
}
export const destinoVacio: Destino = { areaId: '', usuarioId: '' };

/** ¿Falta algo por elegir? (el área solo si el equipo tiene áreas) */
export const destinoIncompleto = (d: Destino, areas: AreaConMiembros[]) => !d.usuarioId || (areas.length > 0 && !d.areaId);

/**
 * A quién se envía. Si el equipo de la etapa siguiente tiene áreas, primero se elige el área y
 * luego aparecen solo las personas de esa área; si no tiene, se elige directo la persona.
 */
export function SelectorDestino({ areas, miembros, valor, alCambiar, etiqueta, intentado }: {
  areas: AreaConMiembros[]; miembros: Persona[]; valor: Destino; alCambiar: (d: Destino) => void; etiqueta: string; intentado?: boolean;
}) {
  const id = useId();
  const area = areas.find((a) => String(a.id) === valor.areaId);
  const personas = areas.length ? area?.miembros ?? [] : miembros;

  // Con una sola área (o una sola persona) se preselecciona
  useEffect(() => {
    if (areas.length === 1 && !valor.areaId) alCambiar({ ...valor, areaId: String(areas[0]!.id) });
  }, [areas, valor, alCambiar]);
  useEffect(() => {
    if (personas.length === 1 && !valor.usuarioId) alCambiar({ ...valor, usuarioId: String(personas[0]!.id) });
  }, [personas, valor, alCambiar]);

  if (!areas.length) {
    return (
      <Campo etiqueta={etiqueta} id={`${id}-p`} requerido error={intentado && !valor.usuarioId ? 'Elige a quién se la envías' : undefined}>
        <Seleccion id={`${id}-p`} value={valor.usuarioId} onChange={(e) => alCambiar({ areaId: '', usuarioId: e.target.value })} invalido={intentado && !valor.usuarioId}>
          <option value="">Elige a la persona</option>
          {miembros.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </Seleccion>
      </Campo>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo etiqueta={`${etiqueta} · Área`} id={`${id}-a`} requerido error={intentado && !valor.areaId ? 'Elige el área' : undefined}>
        <Seleccion id={`${id}-a`} value={valor.areaId} onChange={(e) => alCambiar({ areaId: e.target.value, usuarioId: '' })} invalido={intentado && !valor.areaId}>
          <option value="">Elige el área</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Persona" id={`${id}-p`} requerido
        error={intentado && valor.areaId && !valor.usuarioId ? 'Elige a la persona' : undefined}
        ayuda={!valor.areaId ? 'Primero elige el área' : !personas.length ? 'Esta área no tiene personas activas' : undefined}>
        <Seleccion id={`${id}-p`} value={valor.usuarioId} disabled={!valor.areaId || !personas.length}
          onChange={(e) => alCambiar({ ...valor, usuarioId: e.target.value })} invalido={intentado && !!valor.areaId && !valor.usuarioId}>
          <option value="">{valor.areaId ? 'Elige a la persona' : '—'}</option>
          {personas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </Seleccion>
      </Campo>
    </div>
  );
}
