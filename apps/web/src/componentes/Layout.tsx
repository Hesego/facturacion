import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, FilePlus2, Inbox, ListChecks, LogOut, Menu, Settings, X } from 'lucide-react';
import { api } from '../api/cliente';
import { claves, usePendientes, useYo } from '../api/consultas';
import { MARCA } from '../marca';
import { Logo } from './marca';
import { cx } from './ui';

export const NOMBRE_EQUIPO: Record<string, string> = {
  contabilidad: 'Contabilidad',
  operaciones: 'Operaciones',
  lider_operaciones: 'Líder de operaciones',
  compras: 'Compras',
  gerencia: 'Gerencia',
  gerencia_financiera: 'Gerencia financiera',
  administrador: 'Administrador',
};

function Enlace({ a, icono, children, insignia, alNavegar }: { a: string; icono: ReactNode; children: ReactNode; insignia?: number; alNavegar?: () => void }) {
  return (
    <NavLink to={a} end={a === '/'} onClick={alNavegar}
      className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-xl px-4 py-3 text-[16px] font-bold transition-colors',
        isActive ? 'bg-white/10 text-white' : 'text-navy-suave hover:bg-white/5 hover:text-white')}>
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-gradient-to-b from-naranja to-teal-vivo" />}
          <span className={cx('shrink-0', isActive ? 'text-navy-kicker' : 'text-navy-suave group-hover:text-navy-kicker')}>{icono}</span>
          <span className="flex-1">{children}</span>
          {!!insignia && (
            <span className="rounded-full bg-naranja-profundo px-2 py-0.5 font-etiqueta text-[13px] font-bold leading-none text-white">{insignia}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Navegacion({ alNavegar }: { alNavegar?: () => void }) {
  const { data: yo } = useYo();
  const { data: pendientes } = usePendientes();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const salir = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    qc.setQueryData(claves.yo, null);
    navegar('/login');
  };
  const icono = 'h-5 w-5';
  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-1 px-3" aria-label="Principal">
        <Enlace a="/" icono={<Inbox className={icono} strokeWidth={2} />} insignia={pendientes?.length} alNavegar={alNavegar}>Mis pendientes</Enlace>
        <Enlace a="/transacciones" icono={<ListChecks className={icono} strokeWidth={2} />} alNavegar={alNavegar}>Transacciones</Enlace>
        {yo?.equipos.includes('contabilidad') && (
          <Enlace a="/solicitudes/nueva" icono={<FilePlus2 className={icono} strokeWidth={2} />} alNavegar={alNavegar}>Nueva solicitud</Enlace>
        )}
        <Enlace a="/tablero" icono={<BarChart3 className={icono} strokeWidth={2} />} alNavegar={alNavegar}>Tablero</Enlace>
        {yo?.equipos.includes('administrador') && (
          <Enlace a="/administracion" icono={<Settings className={icono} strokeWidth={2} />} alNavegar={alNavegar}>Administración</Enlace>
        )}
      </nav>

      {yo && (
        <div className="mx-3 mb-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <p className="truncate font-bold text-white">{yo.nombre}</p>
          <p className="truncate text-[14px] text-navy-suave">{yo.email}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {yo.equipos.map((e) => (
              <span key={e} className="rounded-full border border-white/15 px-2.5 py-1 font-etiqueta text-[11px] font-bold uppercase tracking-chip text-navy-kicker">
                {NOMBRE_EQUIPO[e] ?? e}
              </span>
            ))}
          </div>
          <button onClick={salir} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-[15px] font-bold text-white hover:bg-white/10">
            <LogOut className="h-4 w-4" strokeWidth={2} /> Cerrar sesión
          </button>
        </div>
      )}
      <p className="px-6 pb-6 font-etiqueta text-[11px] font-bold uppercase leading-snug tracking-chip text-navy-kicker/80">{MARCA.frase}</p>
    </div>
  );
}

export function Layout() {
  const [menu, setMenu] = useState(false);
  return (
    <div className="min-h-screen lg:pl-72">
      {/* Barra lateral (escritorio) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-panel-navy lg:flex">
        <div className="px-7 pb-8 pt-8">
          <Logo variante="blanco" />
          <p className="mt-5 kicker text-navy-kicker">{MARCA.producto}</p>
        </div>
        <Navegacion />
      </aside>

      {/* Barra superior y menú (celular) */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-panel-navy px-4 py-2 lg:hidden">
        <Logo variante="blanco" />
        <button onClick={() => setMenu(true)} aria-label="Abrir menú" className="rounded-xl p-2.5 text-white hover:bg-white/10">
          <Menu className="h-6 w-6" strokeWidth={2} />
        </button>
      </header>
      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-navy-oscuro/60" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(320px,85vw)] flex-col bg-panel-navy pt-4">
            <button onClick={() => setMenu(false)} aria-label="Cerrar menú" className="mb-4 mr-3 self-end rounded-xl p-2.5 text-white hover:bg-white/10">
              <X className="h-6 w-6" strokeWidth={2} />
            </button>
            <Navegacion alNavegar={() => setMenu(false)} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
