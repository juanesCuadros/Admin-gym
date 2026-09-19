import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { FranjaSuscripcion } from './FranjaSuscripcion';
import { CajaTurnoProvider, useCajaTurno } from '../../contexts/CajaTurnoContext';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError, EVENTOS } from '../../api/client';

/**
 * Regla §C1: un Recepcionista sin turno abierto solo puede estar en /caja
 * (allí se le pide abrir el turno). Cualquier otra ruta vuelve a /caja.
 */
const GuardTurnoRecepcionista: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isRecepcionista, hasPermission } = useAuth();
  const { cargando, error, turnoAbierto } = useCajaTurno();
  const location = useLocation();

  // Si el recepcionista no puede leer caja, la regla la aplica solo el backend (GW-RF-09).
  const debeAbrirTurno = isRecepcionista && hasPermission('caja', 'leer') && !cargando && !error && !turnoAbierto;
  if (debeAbrirTurno && location.pathname !== '/caja') {
    return <Navigate to="/caja" replace state={{ abrirTurno: true }} />;
  }
  return <>{children}</>;
};

const Contenido: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { refrescarUsuario, isRecepcionista, hasPermission } = useAuth();
  const { cargando, error, turnoAbierto } = useCajaTurno();

  // 403 por permiso: sacar al usuario de la vista con mensaje fijo y refrescar sus permisos (§A2).
  useEffect(() => {
    const onPermisoPerdido = (ev: Event) => {
      const err = (ev as CustomEvent<ApiError>).detail;
      refrescarUsuario();
      navigate('/', { replace: true, state: { permisoPerdido: err?.message ?? 'Perdiste el permiso para esa sección.' } });
    };
    window.addEventListener(EVENTOS.permisoPerdido, onPermisoPerdido);
    return () => window.removeEventListener(EVENTOS.permisoPerdido, onPermisoPerdido);
  }, [navigate, refrescarUsuario]);

  const navegacionBloqueada =
    isRecepcionista && hasPermission('caja', 'leer') && !cargando && !error && !turnoAbierto;

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} bloqueada={navegacionBloqueada} />
      <div className="app-content-wrapper">
        <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
        <FranjaSuscripcion />
        <main className="page-container">
          <GuardTurnoRecepcionista>
            <Outlet />
          </GuardTurnoRecepcionista>
        </main>
      </div>
    </div>
  );
};

export const AppLayout: React.FC = () => (
  <CajaTurnoProvider>
    <Contenido />
  </CajaTurnoProvider>
);
