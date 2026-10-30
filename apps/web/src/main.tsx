import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorApi } from './api/cliente';
import { claves } from './api/consultas';
import { App } from './App';
import './estilos.css';

const clienteConsultas: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Sesión vencida en cualquier consulta: se olvida el usuario y la guarda redirige al login
    onError: (e) => {
      if (e instanceof ErrorApi && e.status === 401) clienteConsultas.setQueryData(claves.yo, null);
    },
  }),
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ErrorApi && e.status > 0 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
