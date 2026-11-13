import React from 'react';
import { ToastProvider } from '@web/contexts/ToastContext';
import { FranjaSuscripcion } from './components/FranjaSuscripcion';
import { SesionProvider, useSesion } from './contexts/SesionContext';
import { ActivacionPage } from './pages/ActivacionPage';
import { BloqueoPage } from './pages/BloqueoPage';
import { DescargaInicialPage } from './pages/DescargaInicialPage';
import { ErrorArranquePage } from './pages/ErrorArranquePage';
import { IngresoPage } from './pages/IngresoPage';
import { InicioPage } from './pages/InicioPage';
import { ServicioNoDisponiblePage } from './pages/ServicioNoDisponiblePage';

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
  if (!estacion.activada) return <ActivacionPage estacion={estacion} />;
  if (estacion.revocada || estacion.suscripcion.estado === 'bloqueado') return <ServicioNoDisponiblePage estacion={estacion} />;
  if (!estacion.descarga_inicial_completa) return <DescargaInicialPage estacion={estacion} />;

  let pantalla = <IngresoPage />;
  if (sesion.estado === 'bloqueada' && sesion.usuario) pantalla = <BloqueoPage key={sesion.usuario.id} usuario={sesion.usuario} />;
  else if (sesion.estado === 'activa' && sesion.usuario) pantalla = <InicioPage usuario={sesion.usuario} />;

  return (
    <>
      <FranjaSuscripcion suscripcion={estacion.suscripcion} />
      {pantalla}
    </>
  );
};

const App: React.FC = () => (
  <ToastProvider>
    <SesionProvider>
      <Pantalla />
    </SesionProvider>
  </ToastProvider>
);

export default App;
