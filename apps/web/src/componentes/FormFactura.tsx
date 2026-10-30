import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ErrorApi } from '../api/cliente';
import { archivosFacturas, faltaEnFila, SelectorFacturas, type FilaFactura } from './SelectorFacturas';
import { Alerta, Boton } from './ui';

/** Agregar una o varias facturas a una transacción en curso. */
export function FormFactura({ alGuardar, alCancelar }: {
  alGuardar: (datos: ReturnType<typeof archivosFacturas>) => Promise<void>; alCancelar?: () => void;
}) {
  const [filas, setFilas] = useState<FilaFactura[]>([]);
  const [intentado, setIntentado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setIntentado(true);
    setError(null);
    if (!filas.length || filas.some((f) => faltaEnFila(f))) return;
    setGuardando(true);
    try {
      await alGuardar(archivosFacturas(filas));
      setFilas([]);
      setIntentado(false);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No fue posible guardar las facturas');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border-[1.5px] border-linea bg-papel/50 p-4 sm:p-5">
      {error && <Alerta tono="error">{error}</Alerta>}
      <SelectorFacturas filas={filas} alCambiar={setFilas} intentado={intentado} />
      <div className="flex flex-wrap justify-end gap-3">
        {alCancelar && <Boton type="button" variante="fantasma" onClick={alCancelar}>Cancelar</Boton>}
        <Boton type="button" onClick={guardar} cargando={guardando} icono={<Plus className="h-[18px] w-[18px]" strokeWidth={2} />}>
          {filas.length > 1 ? `Agregar ${filas.length} facturas` : 'Agregar factura'}
        </Boton>
      </div>
    </div>
  );
}
