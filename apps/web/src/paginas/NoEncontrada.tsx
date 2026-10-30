import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Tarjeta, Vacio } from '../componentes/ui';

export function NoEncontrada({ mensaje = 'La página que buscas no existe o cambió de dirección.' }: { mensaje?: string }) {
  return (
    <Tarjeta>
      <Vacio icono={<Compass className="h-7 w-7" strokeWidth={2} />} titulo="No encontramos esto">
        {mensaje} <Link to="/" className="font-bold text-teal-profundo underline underline-offset-2">Volver a mis pendientes</Link>
      </Vacio>
    </Tarjeta>
  );
}
