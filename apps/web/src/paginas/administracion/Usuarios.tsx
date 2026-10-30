import type { AreaAdmin, EquipoAdmin, UsuarioAdmin } from '../../api/tipos';
import { NOMBRE_EQUIPO } from '../../componentes/Layout';
import { Campo, Chip, Entrada } from '../../componentes/ui';
import { formatearFechaHora } from '../../formato';
import { Casillas, DialogoFormulario, Estado, Interruptor, SeccionAdmin, useAdmin, useFormulario, useGuardar } from './comun';

interface Formulario { email: string; nombre: string; cargo: string; password: string; equipos: string[]; areas: number[]; activo: boolean }
const vacio: Formulario = { email: '', nombre: '', cargo: '', password: '', equipos: [], areas: [], activo: true };

export function Usuarios() {
  const { data, isLoading } = useAdmin<UsuarioAdmin>('usuarios');
  const { data: equipos } = useAdmin<EquipoAdmin>('equipos');
  const { data: areas } = useAdmin<AreaAdmin>('areas');
  const guardar = useGuardar();
  const form = useFormulario<Formulario>(vacio);
  const { f, campo } = form;

  const enviar = () => {
    const comun = { nombre: f.nombre, cargo: f.cargo || null, equipos: f.equipos, areas: f.areas };
    guardar.mutate(form.id === null
      ? { metodo: 'post', ruta: 'usuarios', cuerpo: { ...comun, email: f.email, password: f.password } }
      : { metodo: 'patch', ruta: `usuarios/${form.id}`, cuerpo: { ...comun, activo: f.activo, ...(f.password && { password: f.password }) } },
    { onSuccess: form.cerrar });
  };

  return (
    <>
      <SeccionAdmin titulo="Usuarios" textoNuevo="Nuevo usuario"
        descripcion="Cada usuario puede pertenecer a varios equipos. A quien pertenece al equipo de una etapa se le pueden enviar los gastos de esa etapa."
        filas={data} cargando={isLoading}
        nuevo={() => { guardar.reset(); form.abrir(vacio); }}
        editar={(u) => { guardar.reset(); form.abrir({ email: u.email, nombre: u.nombre, cargo: u.cargo ?? '', password: '', equipos: u.equipos, areas: u.areas, activo: u.activo }, u.id); }}
        columnas={[
          { titulo: 'Usuario', celda: (u) => <><p className="font-bold">{u.nombre}</p><p className="text-[14px] text-meta">{u.email}{u.cargo ? ` · ${u.cargo}` : ''}</p></> },
          { titulo: 'Equipos', celda: (u) => <div className="flex flex-wrap gap-1.5">{u.equipos.map((e) => <Chip key={e}>{NOMBRE_EQUIPO[e] ?? e}</Chip>)}</div> },
          { titulo: 'Áreas', celda: (u) => <span className="text-[14px]">{u.areas.map((id) => areas?.find((a) => a.id === id)?.nombre).filter(Boolean).join(', ') || '—'}</span> },
          { titulo: 'A su cargo', celda: (u) => <span className="tabular-nums">{u.asignadas}</span>, clase: 'text-right' },
          { titulo: 'Último acceso', celda: (u) => <span className="text-[14px] text-meta">{u.ultimo_acceso ? formatearFechaHora(u.ultimo_acceso) : 'Nunca'}</span> },
          { titulo: 'Estado', celda: (u) => <Estado activo={u.activo} /> },
        ]} />

      <DialogoFormulario abierto={form.abierto} alCerrar={form.cerrar} kicker="Administración · Usuarios"
        titulo={form.id === null ? 'Nuevo usuario' : 'Editar usuario'} alGuardar={enviar} cargando={guardar.isPending} error={guardar.error}>
        <Campo etiqueta="Correo" id="u-email" requerido>
          <Entrada id="u-email" type="email" value={f.email} onChange={(e) => campo('email', e.target.value)} disabled={form.id !== null} placeholder="nombre@hesegoingenieria.com" />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre" id="u-nombre" requerido><Entrada id="u-nombre" value={f.nombre} onChange={(e) => campo('nombre', e.target.value)} /></Campo>
          <Campo etiqueta="Cargo" id="u-cargo"><Entrada id="u-cargo" value={f.cargo} onChange={(e) => campo('cargo', e.target.value)} /></Campo>
        </div>
        <Campo etiqueta={form.id === null ? 'Contraseña' : 'Nueva contraseña'} id="u-clave" requerido={form.id === null}
          ayuda={form.id === null ? 'Mínimo 10 caracteres, con letras y números.' : 'Déjala vacía para no cambiarla. Cambiarla cierra sus sesiones abiertas.'}>
          <Entrada id="u-clave" type="password" autoComplete="new-password" value={f.password} onChange={(e) => campo('password', e.target.value)} />
        </Campo>
        <Campo etiqueta="Equipos">
          <Casillas valor={f.equipos} alCambiar={(v) => campo('equipos', v)}
            opciones={(equipos ?? []).filter((e) => e.activo).map((e) => ({ valor: e.codigo, etiqueta: e.nombre }))} />
        </Campo>
        {(areas ?? []).some((a) => a.activa && (equipos ?? []).filter((q) => f.equipos.includes(q.codigo)).map((q) => q.id).includes(a.equipo_id)) && (
          <Campo etiqueta="Áreas" ayuda="Solo las de sus equipos. Al enviarle una transacción, se elige el área y luego la persona.">
            <Casillas valor={f.areas} alCambiar={(v) => campo('areas', v)}
              opciones={(areas ?? []).filter((a) => a.activa && (equipos ?? []).filter((q) => f.equipos.includes(q.codigo)).map((q) => q.id).includes(a.equipo_id))
                .map((a) => ({ valor: a.id, etiqueta: a.nombre, detalle: a.equipo }))} />
          </Campo>
        )}
        {form.id !== null && <Interruptor activo={f.activo} alCambiar={(v) => campo('activo', v)} etiqueta="Usuario activo" ayuda="Si lo desactivas, pierde el acceso de inmediato. Antes hay que reasignar sus gastos." />}
      </DialogoFormulario>
    </>
  );
}
