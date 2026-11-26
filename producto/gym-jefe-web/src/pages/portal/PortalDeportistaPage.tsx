import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { Cargando, ErrorCarga } from '../../components/estados/Estados';
import { toApiError } from '../../api/client';
import {
  EVENTO_PORTAL_SESION_EXPIRADA,
  leerSesionPortal,
  limpiarSesionPortal,
  portalService,
} from '../../api/portal.service';
import type {
  AsistenciasPortalResponse,
  FinanzasDeportistaResponse,
  MedicionesPortalResponse,
  PerfilDeportistaResponse,
} from '../../types/portal.types';
import type { TabPortal } from './types';
import { PortalHeader } from './components/PortalHeader';
import { PortalDesktopTabs } from './components/PortalDesktopTabs';
import { PortalMobileMenu } from './components/PortalMobileMenu';
import { TabPerfilMembresia } from './components/TabPerfilMembresia';
import { TabMedidasProgreso } from './components/TabMedidasProgreso';
import { TabPagosCompras } from './components/TabPagosCompras';
import { TabMisAsistencias } from './components/TabMisAsistencias';
import { ModalEditarPerfil } from './components/ModalEditarPerfil';
import { ModalNuevaMedida } from './components/ModalNuevaMedida';

export const PortalDeportistaPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [sesion, setSesion] = useState(() => leerSesionPortal());
  const [tab, setTab] = useState<TabPortal>('perfil');
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);

  const [perfil, setPerfil] = useState<PerfilDeportistaResponse | null>(null);
  const [mediciones, setMediciones] = useState<MedicionesPortalResponse | null>(null);
  const [finanzas, setFinanzas] = useState<FinanzasDeportistaResponse | null>(null);
  const [asistencias, setAsistencias] = useState<AsistenciasPortalResponse | null>(null);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Estados de modales
  const [modalPerfilAbierto, setModalPerfilAbierto] = useState(false);
  const [modalMedidaAbierto, setModalMedidaAbierto] = useState(false);

  useEffect(() => {
    const onExpirada = () => {
      setSesion(null);
      navigate('/portal/login', { replace: true });
    };
    window.addEventListener(EVENTO_PORTAL_SESION_EXPIRADA, onExpirada);
    return () => window.removeEventListener(EVENTO_PORTAL_SESION_EXPIRADA, onExpirada);
  }, [navigate]);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const [p, m, f, a] = await Promise.all([
        portalService.obtenerPerfil(),
        portalService.obtenerMediciones(),
        portalService.obtenerFinanzas(),
        portalService.obtenerAsistencias(),
      ]);
      setPerfil(p);
      setMediciones(m);
      setFinanzas(f);
      setAsistencias(a);
    } catch (err) {
      setErrorCarga(toApiError(err).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (sesion) {
      cargarTodo();
    }
  }, [sesion, cargarTodo]);

  if (!sesion) {
    return <Navigate to="/portal/login" replace />;
  }

  const handleCerrarSesion = () => {
    limpiarSesionPortal();
    setSesion(null);
    showToast('info', 'Sesión cerrada correctamente');
    navigate('/portal/login', { replace: true });
  };

  const recargarMedicionesYPerfil = async () => {
    try {
      const [nuevasMed, nuevoPerfil] = await Promise.all([
        portalService.obtenerMediciones(),
        portalService.obtenerPerfil(),
      ]);
      setMediciones(nuevasMed);
      setPerfil(nuevoPerfil);
    } catch {
      // Ignorar error secundario de recarga silenciosa
    }
  };

  if (cargando) {
    return (
      <div style={{ maxWidth: 1080, margin: '32px auto', padding: '0 20px' }}>
        <Cargando filas={6} alto={48} etiqueta="Cargando tu portal de deportista..." />
      </div>
    );
  }

  if (errorCarga || !perfil) {
    return (
      <div style={{ maxWidth: 680, margin: '48px auto', padding: '0 20px' }}>
        <ErrorCarga error={new Error(errorCarga || 'No se pudo cargar tu información')} onReintentar={cargarTodo} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)' }}>
      {/* 1. Header principal con botón hamburguesa (3 líneas) en móvil */}
      <PortalHeader
        perfil={perfil}
        onCerrarSesion={handleCerrarSesion}
        onAbrirMenu={() => setMenuMovilAbierto(true)}
      />

      {/* 2. Pestañas en desktop */}
      <PortalDesktopTabs activeTab={tab} onSelectTab={setTab} />

      {/* 3. Menú móvil deslizable para saltar entre secciones */}
      <PortalMobileMenu
        isOpen={menuMovilAbierto}
        onClose={() => setMenuMovilAbierto(false)}
        activeTab={tab}
        onSelectTab={setTab}
        onCerrarSesion={handleCerrarSesion}
        nombreUsuario={perfil.nombre}
        gimnasioNombre={perfil.gimnasio_nombre}
      />

      {/* 4. Contenedor de la pestaña activa (responsabilidad única por componente) */}
      <main className="portal-page-container" style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px 64px' }}>
        {tab === 'perfil' && (
          <TabPerfilMembresia
            perfil={perfil}
            onAbrirEditarPerfil={() => setModalPerfilAbierto(true)}
          />
        )}

        {tab === 'progreso' && mediciones && (
          <TabMedidasProgreso
            mediciones={mediciones}
            onAbrirNuevaMedida={() => setModalMedidaAbierto(true)}
          />
        )}

        {tab === 'finanzas' && finanzas && (
          <TabPagosCompras finanzas={finanzas} />
        )}

        {tab === 'asistencias' && asistencias && (
          <TabMisAsistencias asistencias={asistencias} />
        )}
      </main>

      {/* 5. Modales especializados */}
      <ModalEditarPerfil
        isOpen={modalPerfilAbierto}
        onClose={() => setModalPerfilAbierto(false)}
        perfil={perfil}
        onPerfilActualizado={setPerfil}
      />

      <ModalNuevaMedida
        isOpen={modalMedidaAbierto}
        onClose={() => setModalMedidaAbierto(false)}
        perfil={perfil}
        onMedicionGuardada={recargarMedicionesYPerfil}
      />
    </div>
  );
};
