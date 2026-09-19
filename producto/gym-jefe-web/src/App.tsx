import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { TenantThemeProvider } from './contexts/TenantThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
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
import { DeportistasPage } from './pages/deportistas/DeportistasPage';
import { MembresiasPage } from './pages/membresias/MembresiasPage';
import { ClasesPage } from './pages/clases/ClasesPage';
import { EntrenamientoPage } from './pages/entrenamiento/EntrenamientoPage';

// Administración
import { PersonalPage } from './pages/personal/PersonalPage';

import { enConstruccion, PantallaTvAccesoPage } from './pages/enConstruccion/EnConstruccionPage';

import './styles/components.css';

// Rutas del menú (§B2) que aún no tienen pantalla: estado vacío honesto, sin datos falsos.
const IngresosHoyPage = enConstruccion('Ingresos de hoy');
const PuntoDeVentaPage = enConstruccion('Punto de venta');
const HistorialTurnosPage = enConstruccion('Historial de turnos');
const RutinasAsignadasPage = enConstruccion('Rutinas asignadas');
const ProductosPage = enConstruccion('Productos');
const MovimientosStockPage = enConstruccion('Movimientos de stock');
const ReporteIngresosPage = enConstruccion('Reportes · Ingresos');
const ReporteMembresiasPage = enConstruccion('Reportes · Membresías');
const ReporteAsistenciaPage = enConstruccion('Reportes · Asistencia');
const StaffPage = enConstruccion('Staff');
const ConfigGeneralPage = enConstruccion('Configuración · General');
const ConfigLandingPage = enConstruccion('Configuración · Landing');
const ConfigMetodosPagoPage = enConstruccion('Configuración · Métodos de pago');
const ConfigParametrosPage = enConstruccion('Configuración · Parámetros');
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

                  <Route element={<ProtectedRoute soloJefe />}>
                    <Route path="/auditoria" element={<AuditoriaPage />} />
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
