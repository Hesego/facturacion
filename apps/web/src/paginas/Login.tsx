import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { credenciales } from '@gastos/shared';
import type { z } from 'zod';
import { api, ErrorApi } from '../api/cliente';
import { claves, useYo } from '../api/consultas';
import { Logo } from '../componentes/marca';
import { Alerta, Boton, Campo, Entrada, ReglaColor } from '../componentes/ui';
import { MARCA } from '../marca';

type Credenciales = z.infer<typeof credenciales>;

export function Login() {
  const { data: yo } = useYo();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const desde = (useLocation().state as { desde?: string } | null)?.desde ?? '/';
  const [error, setError] = useState<string | null>(null);
  const [verClave, setVerClave] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Credenciales>({ resolver: zodResolver(credenciales) });

  if (yo) return <Navigate to={desde} replace />;

  const entrar = handleSubmit(async (datos) => {
    setError(null);
    try {
      await api.post('/auth/login', datos);
      await qc.invalidateQueries({ queryKey: claves.yo });
      navegar(desde, { replace: true });
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No fue posible iniciar sesión');
    }
  });

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Panel navy con corte diagonal y la barra teal → naranja pegada al corte (lámina 15) */}
      <aside className="relative overflow-hidden bg-panel-navy px-6 pb-12 pt-8 sm:px-10 lg:w-[46%] lg:pb-10 lg:pt-12"
        style={{ clipPath: 'polygon(0 0, 100% 0, 88% 100%, 0 100%)' }}>
        <div aria-hidden className="absolute inset-y-0 right-0 hidden w-[12%] lg:block"
          style={{ background: 'linear-gradient(180deg, #00AEC6 0%, #FF6B1A 100%)', clipPath: 'polygon(96% 0, 100% 0, 4% 100%, 0 100%)' }} />
        <div className="relative flex h-full max-w-md flex-col">
          <Logo variante="blanco" alto={96} />
          <div className="mt-10 lg:mt-auto">
            <p className="kicker text-navy-kicker">{MARCA.nombre}</p>
            <h1 className="titular mt-3 text-[44px] text-white sm:text-[60px]">Flujo de<br />gastos</h1>
            <ReglaColor className="mt-5" />
            <p className="mt-5 max-w-sm text-[17px] text-navy-texto">
              Cada gasto, de la solicitud al pago, con sus soportes y su historial en un solo lugar.
            </p>
          </div>
          <p className="mt-10 font-etiqueta text-[12px] font-bold uppercase tracking-kicker text-navy-kicker/80 lg:mb-2">{MARCA.frase}</p>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <form onSubmit={entrar} noValidate className="tarjeta tarjeta-acento w-full max-w-md px-6 pb-8 pt-9 sm:px-9">
          <p className="kicker">Bienvenido</p>
          <h2 className="titular mt-2 text-[32px]">Inicia sesión</h2>
          <p className="mt-2 text-secundario">Usa tu correo corporativo.</p>

          <div className="mt-7 space-y-5">
            {error && <Alerta tono="error">{error}</Alerta>}
            <Campo etiqueta="Correo" id="email" error={errors.email?.message}>
              <Entrada id="email" type="email" autoComplete="username" autoFocus placeholder="nombre@hesegoingenieria.com"
                invalido={!!errors.email} {...register('email')} />
            </Campo>
            <Campo etiqueta="Contraseña" id="password" error={errors.password?.message}>
              <div className="relative">
                <Entrada id="password" type={verClave ? 'text' : 'password'} autoComplete="current-password" className="pr-12"
                  invalido={!!errors.password} {...register('password')} />
                <button type="button" onClick={() => setVerClave((v) => !v)} aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute inset-y-0 right-0 flex items-center px-3.5 text-meta hover:text-teal-profundo">
                  {verClave ? <EyeOff className="h-5 w-5" strokeWidth={2} /> : <Eye className="h-5 w-5" strokeWidth={2} />}
                </button>
              </div>
            </Campo>
            <Boton type="submit" tamano="grande" className="w-full" cargando={isSubmitting} icono={<LogIn className="h-5 w-5" strokeWidth={2} />}>
              Entrar
            </Boton>
          </div>
        </form>
      </main>
    </div>
  );
}
