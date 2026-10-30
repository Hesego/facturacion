import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from './cliente';
import type { Catalogos, Detalle, Listado, Pendiente, Yo } from './tipos';

export const claves = {
  yo: ['yo'] as const,
  catalogos: ['catalogos'] as const,
  pendientes: ['pendientes'] as const,
  listado: (f: object) => ['transacciones', f] as const,
  detalle: (id: number) => ['transaccion', id] as const,
};

export function useYo() {
  return useQuery({
    queryKey: claves.yo,
    queryFn: async () => {
      try {
        return await api.get<Yo>('/auth/yo');
      } catch (e) {
        if (e instanceof ErrorApi && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export const useCatalogos = () => useQuery({ queryKey: claves.catalogos, queryFn: () => api.get<Catalogos>('/catalogos'), staleTime: 5 * 60_000 });

export const usePendientes = () =>
  useQuery({ queryKey: claves.pendientes, queryFn: () => api.get<Pendiente[]>('/pendientes'), refetchInterval: 60_000 });

export function useListado(filtro: Record<string, string | number | undefined>) {
  const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  return useQuery({ queryKey: claves.listado(filtro), queryFn: () => api.get<Listado>(`/transacciones?${q}`), placeholderData: (previo) => previo });
}

export const useDetalle = (id: number) =>
  useQuery({ queryKey: claves.detalle(id), queryFn: () => api.get<Detalle>(`/transacciones/${id}`) });

/**
 * Mutación sobre una transacción: al terminar (bien o mal) se recargan su detalle, los
 * pendientes y el listado, para que nadie actúe sobre datos viejos.
 */
export function useAccionTransaccion<V>(id: number, fn: (variables: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: claves.detalle(id) }),
      qc.invalidateQueries({ queryKey: claves.pendientes }),
      qc.invalidateQueries({ queryKey: ['transacciones'] }),
    ]),
  });
}
