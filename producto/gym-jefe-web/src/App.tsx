import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { TenantThemeProvider } from './contexts/TenantThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { RutaModuloActivo } from './components/layout/RutaModuloActivo';
import { EVENTOS } from './api/client';

// Públicas
import { LoginPage } from './pages/auth/LoginPage';
import { RecuperarPage } from './pages/auth/RecuperarPage';
import { NuevaClavePage } from './pages/auth/NuevaClavePage';
import { CambiarClavePage } from './pages/auth/CambiarClavePage';
import { BloqueadoPage } from './pages/bloqueado/BloqueadoPage';
import { PantallaTvPage } from './pages/pantallaTv/PantallaTvPage';

// Operación
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ControlIngresoPage } from './pages/controlIngreso/ControlIngresoPage';
import { CajaPage } from './pages/caja/CajaPage';
import { PuntoDeVentaPage } from './pages/caja/PuntoDeVentaPage';
import { HistorialTurnosPage } from './pages/caja/HistorialTurnosPage';
import { DeportistasPage } from './pages/deportistas/DeportistasPage';
import { MembresiasPage } from './pages/membresias/MembresiasPage';
import { ClasesPage } from './pages/clases/ClasesPage';
import { EntrenamientoPage } from './pages/entrenamiento/EntrenamientoPage';

import { ProductosPage } from './pages/inventario/ProductosPage';
import { MovimientosStockPage } from './pages/inventario/MovimientosStockPage';
import { ReporteIngresosPage } from './pages/reportes/ReporteIngresosPage';

// Administración
import { PersonalPage } from './pages/personal/PersonalPage';
import { StaffPage } from './pages/personal/StaffPage';
import { ConfigGeneralPage } from './pages/configuracion/ConfigGeneralPage';
import { ConfigLandingPage } from './pages/configuracion/ConfigLandingPage';
import { ConfigMetodosPagoPage } from './pages/configuracion/ConfigMetodosPagoPage';
import { ConfigParametrosPage } from './pages/configuracion/ConfigParametrosPage';
import { MiSuscripcionPage } from './pages/configuracion/MiSuscripcionPage';

import { enConstruccion, PantallaTvAccesoPage } from './pages/enConstruccion/EnConstruccionPage';

import './styles/components.css';

// Rutas del menú (§B2) que aún no tienen pantalla: estado vacío honesto, sin datos falsos.
const IngresosHoyPage = enConstruccion('Ingresos de hoy');
const RutinasAsignadasPage = enConstruccion('Rutinas asignadas');
const ReporteMembresiasPage = enConstruccion('Reportes · Membresías');
const ReporteAsistenciaPage = enConstruccion('Reportes · Asistencia');
const AuditoriaPage = enConstruccion('Auditoría');

/** Escucha eventos del interceptor que exigen cambiar de ruta. */
const EventosGlobales: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const onSuspendido = () => navigate('/bloqueado', { replace: true, state: { motivo: 'suspendido' } });
    window.addEventListener(EVENTOS.gimnasioSuspendido, onSuspendido);
    return () => window.removeEventListener(EVENTOS.gimnasioSuspendido, onSuspendido);
  }, [navigate]);
  return null;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <TenantThemeProvider>
          <AuthProvider>
            <EventosGlobales />
            <Routes>
              {/* Públicas, fuera del layout autenticado */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/recuperar" element={<RecuperarPage />} />
              <Route path="/recuperar/:token" element={<NuevaClavePage />} />
              <Route path="/bloqueado" element={<BloqueadoPage />} />
              <Route path="/pantalla-tv" element={<PantallaTvPage />} />
              <Route path="/tv/:subdominio" element={<PantallaTvPage />} />

              {/* Requiere sesión pero bloquea la navegación (§C4) */}
              <Route element={<ProtectedRoute />}>
                <Route path="/cambiar-clave" element={<CambiarClavePage />} />
              </Route>

              {/* Aplicación autenticada */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />

                  {/* Submódulos apagados con VITE_MODULOS_ACTIVOS: su ruta lleva a Inicio */}
                  <Route element={<RutaModuloActivo />}>
                    <Route element={<ProtectedRoute requiredSubmodule="control_ingreso" />}>
                      <Route path="/control-ingreso" element={<ControlIngresoPage />} />
                      <Route path="/control-ingreso/ingresos-hoy" element={<IngresosHoyPage />} />
                      <Route path="/control-ingreso/pantalla-tv" element={<PantallaTvAccesoPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="caja" />}>
                      <Route path="/caja" element={<CajaPage />} />
                      <Route path="/caja/punto-de-venta" element={<PuntoDeVentaPage />} />
                      <Route path="/caja/historial" element={<HistorialTurnosPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="deportistas" />}>
                      <Route path="/deportistas" element={<DeportistasPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="membresias" />}>
                      <Route path="/membresias" element={<MembresiasPage tabInicial="membresias" />} />
                      <Route path="/membresias/planes" element={<MembresiasPage tabInicial="planes" />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="clases" />}>
                      <Route path="/clases" element={<ClasesPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="entrenamiento" />}>
                      <Route path="/entrenamiento" element={<EntrenamientoPage tabInicial="ejercicios" />} />
                      <Route path="/entrenamiento/plantillas" element={<EntrenamientoPage tabInicial="plantillas" />} />
                      <Route path="/entrenamiento/rutinas" element={<RutinasAsignadasPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="inventario" />}>
                      <Route path="/inventario" element={<ProductosPage />} />
                      <Route path="/inventario/movimientos" element={<MovimientosStockPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="reportes" />}>
                      <Route path="/reportes" element={<ReporteIngresosPage />} />
                      <Route path="/reportes/membresias" element={<ReporteMembresiasPage />} />
                      <Route path="/reportes/asistencia" element={<ReporteAsistenciaPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="personal" />}>
                      <Route path="/personal" element={<StaffPage />} />
                      <Route path="/personal/permisos" element={<PersonalPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="configuracion" />}>
                      <Route path="/configuracion" element={<ConfigGeneralPage />} />
                      <Route path="/configuracion/landing" element={<ConfigLandingPage />} />
                      <Route path="/configuracion/metodos-pago" element={<ConfigMetodosPagoPage />} />
                      <Route path="/configuracion/parametros" element={<ConfigParametrosPage />} />
                    </Route>

                    {/* Mi suscripción: solo el Jefe (contrato 2.6) */}
                    <Route element={<ProtectedRoute soloJefe />}>
                      <Route path="/configuracion/suscripcion" element={<MiSuscripcionPage />} />
                    </Route>

                    <Route element={<ProtectedRoute soloJefe />}>
                      <Route path="/auditoria" element={<AuditoriaPage />} />
                    </Route>
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </TenantThemeProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
