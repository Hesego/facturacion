import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useYo } from './api/consultas';
import { Layout } from './componentes/Layout';
import { Cargando } from './componentes/ui';
import { Detalle } from './paginas/detalle/Detalle';
import { Login } from './paginas/Login';
import { NoEncontrada } from './paginas/NoEncontrada';
import { NuevaSolicitud } from './paginas/NuevaSolicitud';
import { Pendientes } from './paginas/Pendientes';
import { Transacciones } from './paginas/Transacciones';
import { Tablero } from './paginas/Tablero';
import { Administracion } from './paginas/administracion/Administracion';

function RequiereSesion() {
  const { data: yo, isLoading } = useYo();
  const ubicacion = useLocation();
  if (isLoading) return <Cargando />;
  if (!yo) return <Navigate to="/login" replace state={{ desde: ubicacion.pathname }} />;
  return <Layout />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequiereSesion />}>
          <Route index element={<Pendientes />} />
          <Route path="transacciones" element={<Transacciones />} />
          <Route path="transacciones/:id" element={<Detalle />} />
          <Route path="solicitudes/nueva" element={<NuevaSolicitud />} />
          <Route path="tablero" element={<Tablero />} />
          <Route path="administracion" element={<Administracion />} />
          <Route path="*" element={<NoEncontrada />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
