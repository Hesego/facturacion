import { useSearchParams } from 'react-router-dom';
import { useYo } from '../../api/consultas';
import { cx, EncabezadoPagina } from '../../componentes/ui';
import { NoEncontrada } from '../NoEncontrada';
import { Configuracion } from './Configuracion';
import { Etapas } from './Etapas';
import { Areas, Equipos } from './Organizacion';
import { Usuarios } from './Usuarios';

const PESTANAS = {
  usuarios: { etiqueta: 'Usuarios', Componente: Usuarios },
  equipos: { etiqueta: 'Equipos', Componente: Equipos },
  areas: { etiqueta: 'Áreas', Componente: Areas },
  etapas: { etiqueta: 'Etapas del flujo', Componente: Etapas },
  configuracion: { etiqueta: 'Configuración', Componente: Configuracion },
} as const;
type Pestana = keyof typeof PESTANAS;

export function Administracion() {
  const { data: yo } = useYo();
  const [params, setParams] = useSearchParams();
  const actual = (params.get('pestana') as Pestana) in PESTANAS ? (params.get('pestana') as Pestana) : 'usuarios';
  if (!yo?.equipos.includes('administrador')) return <NoEncontrada mensaje="La administración es solo para el equipo administrador." />;
  const { Componente } = PESTANAS[actual];

  return (
    <>
      <EncabezadoPagina kicker="Equipo administrador" titulo="Administración">
        Usuarios, equipos y sus áreas, etapas del flujo y reglas generales.
      </EncabezadoPagina>
      <nav className="-mx-4 mb-8 overflow-x-auto px-4" aria-label="Secciones de administración">
        <ul className="flex min-w-max gap-1 border-b-[1.5px] border-linea">
          {(Object.keys(PESTANAS) as Pestana[]).map((p) => (
            <li key={p}>
              <button onClick={() => setParams({ pestana: p }, { replace: true })} aria-current={p === actual ? 'page' : undefined}
                className={cx('relative px-4 py-3 font-etiqueta text-[15px] font-bold uppercase tracking-chip transition-colors',
                  p === actual ? 'text-tinta' : 'text-meta hover:text-teal-profundo')}>
                {PESTANAS[p].etiqueta}
                {p === actual && <span aria-hidden className="absolute inset-x-2 -bottom-[1.5px] h-1 rounded-full bg-regla" />}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <Componente />
    </>
  );
}
