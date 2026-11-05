import type { AreaAdmin, EquipoAdmin, UsuarioAdmin } from '../../api/tipos';
import { AreaTexto, Campo, Chip, Entrada, Seleccion } from '../../componentes/ui';
import { DialogoFormulario, Estado, filtroEstado, Interruptor, SeccionAdmin, useAdmin, useFormulario, useGuardar } from './comun';

const opcionesUsuarios = (usuarios: UsuarioAdmin[] | undefined) => (
  <>
    <option value="">Sin asignar</option>
    {(usuarios ?? []).filter((u) => u.activo).map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.email}</option>)}
  </>
);

// ---------------------------------------------------------------------------

interface FEquipo { codigo: string; nombre: string; descripcion: string; liderUsuarioId: string; activo: boolean }

export function Equipos() {
  const { data, isLoading } = useAdmin<EquipoAdmin>('equipos');
  const { data: usuarios } = useAdmin<UsuarioAdmin>('usuarios');
  const guardar = useGuardar();
  const form = useFormulario<FEquipo>({ codigo: '', nombre: '', descripcion: '', liderUsuarioId: '', activo: true });
  const { f, campo } = form;
  const enviar = () => {
    const cuerpo = { ...f, liderUsuarioId: f.liderUsuarioId ? Number(f.liderUsuarioId) : null };
    guardar.mutate(form.id === null ? { metodo: 'post', ruta: 'equipos', cuerpo } : { metodo: 'put', ruta: `equipos/${form.id}`, cuerpo }, { onSuccess: form.cerrar });
  };
  return (
    <>
      <SeccionAdmin titulo="Equipos" textoNuevo="Nuevo equipo" filas={data} cargando={isLoading}
        descripcion="Cada etapa del flujo tiene un equipo responsable. El líder del equipo recibe el escalamiento cuando una etapa vence."
        buscarEn={(e) => [e.nombre, e.codigo, e.lider_nombre, e.descripcion, ...(e.etapas ?? [])]} textoBuscar="Buscar por nombre, código, líder o etapa"
        filtros={[
          { id: 'lider', todos: 'Con y sin líder', opciones: [{ valor: 'con', etiqueta: 'Con líder' }, { valor: 'sin', etiqueta: 'Sin líder' }],
            cumple: (e, v) => (e.lider_usuario_id !== null) === (v === 'con') },
          filtroEstado((e: EquipoAdmin) => e.activo),
        ]}
        nuevo={() => { guardar.reset(); form.abrir({ codigo: '', nombre: '', descripcion: '', liderUsuarioId: '', activo: true }); }}
        editar={(e) => { guardar.reset(); form.abrir({ codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion ?? '', liderUsuarioId: e.lider_usuario_id ? String(e.lider_usuario_id) : '', activo: e.activo }, e.id); }}
        columnas={[
          { titulo: 'Equipo', celda: (e) => <><p className="font-bold">{e.nombre}</p><p className="font-mono text-[13px] text-meta">{e.codigo}</p></> },
          { titulo: 'Líder (escalamiento)', celda: (e) => e.lider_nombre ?? <span className="text-meta">Sin asignar</span> },
          { titulo: 'Miembros', celda: (e) => <span className="tabular-nums">{e.miembros}</span>, clase: 'text-right' },
          { titulo: 'Etapas', celda: (e) => <div className="flex flex-wrap gap-1.5">{(e.etapas ?? []).map((c) => <Chip key={c}>{c}</Chip>)}</div> },
          { titulo: 'Estado', celda: (e) => <Estado activo={e.activo} /> },
        ]} />
      <DialogoFormulario abierto={form.abierto} alCerrar={form.cerrar} kicker="Administración · Equipos" titulo={form.id === null ? 'Nuevo equipo' : 'Editar equipo'}
        alGuardar={enviar} cargando={guardar.isPending} error={guardar.error}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Código" id="e-codigo" requerido ayuda={form.id === null ? 'Minúsculas y guion bajo. No se cambia después.' : 'No se cambia: lo usan los permisos.'}>
            <Entrada id="e-codigo" value={f.codigo} disabled={form.id !== null} onChange={(e) => campo('codigo', e.target.value)} placeholder="tesoreria" />
          </Campo>
          <Campo etiqueta="Nombre" id="e-nombre" requerido><Entrada id="e-nombre" value={f.nombre} onChange={(e) => campo('nombre', e.target.value)} /></Campo>
        </div>
        <Campo etiqueta="Descripción" id="e-desc"><AreaTexto id="e-desc" value={f.descripcion} onChange={(e) => campo('descripcion', e.target.value)} /></Campo>
        <Campo etiqueta="Líder del equipo" id="e-lider" ayuda="Recibe el escalamiento de las etapas vencidas de este equipo.">
          <Seleccion id="e-lider" value={f.liderUsuarioId} onChange={(e) => campo('liderUsuarioId', e.target.value)}>{opcionesUsuarios(usuarios)}</Seleccion>
        </Campo>
        <Interruptor activo={f.activo} alCambiar={(v) => campo('activo', v)} etiqueta="Equipo activo" />
      </DialogoFormulario>
    </>
  );
}

// ---------------------------------------------------------------------------

interface FArea { equipoId: string; codigo: string; nombre: string; activa: boolean }

export function Areas() {
  const { data, isLoading } = useAdmin<AreaAdmin>('areas');
  const { data: equipos } = useAdmin<EquipoAdmin>('equipos');
  const guardar = useGuardar();
  const form = useFormulario<FArea>({ equipoId: '', codigo: '', nombre: '', activa: true });
  const { f, campo } = form;
  const enviar = () => {
    const cuerpo = { ...f, equipoId: Number(f.equipoId) };
    guardar.mutate(form.id === null ? { metodo: 'post', ruta: 'areas', cuerpo } : { metodo: 'put', ruta: `areas/${form.id}`, cuerpo }, { onSuccess: form.cerrar });
  };
  return (
    <>
      <SeccionAdmin titulo="Áreas" textoNuevo="Nueva área" filas={data} cargando={isLoading}
        descripcion="Áreas dentro de un equipo (p. ej. Operaciones → SST, TICS, Inventario). Al enviar a una etapa de ese equipo se elige el área y luego la persona. Los miembros de cada área se asignan en Usuarios."
        buscarEn={(a) => [a.nombre, a.codigo, a.equipo]} textoBuscar="Buscar por nombre, código o equipo"
        filtros={[
          { id: 'equipo', todos: 'Todos los equipos', opciones: (equipos ?? []).map((q) => ({ valor: String(q.id), etiqueta: q.nombre })),
            cumple: (a, v) => a.equipo_id === Number(v) },
          filtroEstado((a: AreaAdmin) => a.activa),
        ]}
        nuevo={() => { guardar.reset(); form.abrir({ equipoId: '', codigo: '', nombre: '', activa: true }); }}
        editar={(a) => { guardar.reset(); form.abrir({ equipoId: String(a.equipo_id), codigo: a.codigo, nombre: a.nombre, activa: a.activa }, a.id); }}
        columnas={[
          { titulo: 'Equipo', celda: (a) => a.equipo },
          { titulo: 'Área', celda: (a) => <><p className="font-bold">{a.nombre}</p><p className="font-mono text-[13px] text-meta">{a.codigo}</p></> },
          { titulo: 'Miembros', celda: (a) => <span className="tabular-nums">{a.miembros}</span>, clase: 'text-right' },
          { titulo: 'En curso', celda: (a) => <span className="tabular-nums">{a.en_curso}</span>, clase: 'text-right' },
          { titulo: 'Estado', celda: (a) => <Estado activo={a.activa} /> },
        ]} />
      <DialogoFormulario abierto={form.abierto} alCerrar={form.cerrar} kicker="Administración · Áreas" titulo={form.id === null ? 'Nueva área' : 'Editar área'}
        alGuardar={enviar} cargando={guardar.isPending} error={guardar.error}>
        <Campo etiqueta="Equipo" id="a-equipo" requerido ayuda={form.id !== null ? 'Un área no se cambia de equipo.' : undefined}>
          <Seleccion id="a-equipo" value={f.equipoId} disabled={form.id !== null} onChange={(e) => campo('equipoId', e.target.value)}>
            <option value="">Elige el equipo</option>
            {(equipos ?? []).filter((q) => q.activo).map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
          </Seleccion>
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Código" id="a-codigo" requerido ayuda="Mayúsculas, p. ej. SST"><Entrada id="a-codigo" value={f.codigo} onChange={(e) => campo('codigo', e.target.value.toUpperCase())} /></Campo>
          <Campo etiqueta="Nombre" id="a-nombre" requerido><Entrada id="a-nombre" value={f.nombre} onChange={(e) => campo('nombre', e.target.value)} /></Campo>
        </div>
        <Interruptor activo={f.activa} alCambiar={(v) => campo('activa', v)} etiqueta="Área activa" ayuda="No se desactiva mientras tenga gastos en curso." />
      </DialogoFormulario>
    </>
  );
}
