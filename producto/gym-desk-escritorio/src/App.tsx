import React from 'react';
import { ToastProvider } from '@web/contexts/ToastContext';
import { SesionProvider, useSesion } from './contexts/SesionContext';
import { BloqueoPage } from './pages/BloqueoPage';
import { ErrorArranquePage } from './pages/ErrorArranquePage';
import { EstacionSinActivarPage } from './pages/EstacionSinActivarPage';
import { IngresoPage } from './pages/IngresoPage';
import { InicioPage } from './pages/InicioPage';

/** La pantalla la decide el estado de la estación y de la sesión; no hay rutas que saltarse. */
const Pantalla: React.FC = () => {
  const { cargando, errorArranque, estacion, sesion, recargar } = useSesion();

  if (cargando) {
    return (
      <main className="gd-centro" aria-busy="true">
        <div className="skeleton" style={{ width: 380, height: 220, borderRadius: 16 }} />
        <span className="gd-pie">Abriendo GymDesk…</span>
      </main>
    );
  }
  if (errorArranque) return <ErrorArranquePage error={errorArranque} onReintentar={() => void recargar()} />;
  if (!estacion || !sesion) return null;
  if (!estacion.activada) return <EstacionSinActivarPage estacion={estacion} />;
  if (sesion.estado === 'bloqueada' && sesion.usuario) return <BloqueoPage key={sesion.usuario.id} usuario={sesion.usuario} />;
  if (sesion.estado === 'activa' && sesion.usuario) return <InicioPage usuario={sesion.usuario} />;
  return <IngresoPage />;
};

const App: React.FC = () => (
  <ToastProvider>
    <SesionProvider>
      <Pantalla />
    </SesionProvider>
  </ToastProvider>
);

export default App;
