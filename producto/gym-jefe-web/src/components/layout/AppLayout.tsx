import React, { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { FranjaSuscripcion } from './FranjaSuscripcion';
import { CajaTurnoProvider } from '../../contexts/CajaTurnoContext';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError, EVENTOS } from '../../api/client';

const Contenido: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Cierra el menu movil al cambiar de ruta y con la tecla Escape.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSidebarOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);
  const { refrescarUsuario } = useAuth();

  // 403 por permiso: sacar al usuario de la vista con mensaje fijo y refrescar sus permisos (§A2).
  useEffect(() => {
    const onPermisoPerdido = (ev: Event) => {
      const err = (ev as CustomEvent<ApiError>).detail;
      refrescarUsuario();
      navigate('/inicio', { replace: true, state: { permisoPerdido: err?.message ?? 'Perdiste el permiso para esa sección.' } });
    };
    window.addEventListener(EVENTOS.permisoPerdido, onPermisoPerdido);
    return () => window.removeEventListener(EVENTOS.permisoPerdido, onPermisoPerdido);
  }, [navigate, refrescarUsuario]);

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-content-wrapper">
        <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
        <FranjaSuscripcion />
        <main className="page-container">
          <Outlet />
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
