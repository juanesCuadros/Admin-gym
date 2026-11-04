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
import { HistorialIngresosPage } from './pages/controlIngreso/HistorialIngresosPage';
import { MedicionesPage } from './pages/deportistas/MedicionesPage';
import { CajaPage } from './pages/caja/CajaPage';
import { PuntoDeVentaPage } from './pages/caja/PuntoDeVentaPage';
import { HistorialTurnosPage } from './pages/caja/HistorialTurnosPage';
import { DeportistasPage } from './pages/deportistas/DeportistasPage';
import { MembresiasPage } from './pages/membresias/MembresiasPage';
import { ClasesPage } from './pages/clases/ClasesPage';
import { EntrenamientoPage } from './pages/entrenamiento/EntrenamientoPage';
import { RutinasAsignadasPage } from './pages/entrenamiento/RutinasAsignadasPage';

import { ProductosPage } from './pages/inventario/ProductosPage';
import { MovimientosStockPage } from './pages/inventario/MovimientosStockPage';
import { ReporteIngresosPage } from './pages/reportes/ReporteIngresosPage';
import { ReporteMembresiasPage } from './pages/reportes/ReporteMembresiasPage';
import { ReporteAsistenciaPage } from './pages/reportes/ReporteAsistenciaPage';

// Administración
import { PersonalPage } from './pages/personal/PersonalPage';
import { StaffPage } from './pages/personal/StaffPage';
import { ConfigGeneralPage } from './pages/configuracion/ConfigGeneralPage';
import { ConfigLandingPage } from './pages/configuracion/ConfigLandingPage';
import { MiSuscripcionPage } from './pages/configuracion/MiSuscripcionPage';
import { CargaInicialPage } from './pages/configuracion/CargaInicialPage';
import { LandingGimnasioPage } from './pages/publico/LandingGimnasioPage';
import { AvisosVencimientoPage } from './pages/membresias/AvisosVencimientoPage';
import { GastosPage } from './pages/gastos/GastosPage';
import { TurnosTrabajoPage } from './pages/personal/TurnosTrabajoPage';

import { PantallaTvConfigPage } from './pages/controlIngreso/PantallaTvConfigPage';

import './styles/components.css';

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
              <Route path="/" element={<LandingGimnasioPage />} />
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
                  <Route path="/inicio" element={<DashboardPage />} />

                  {/* Submódulos apagados con VITE_MODULOS_ACTIVOS: su ruta lleva a Inicio */}
                  <Route element={<RutaModuloActivo />}>
                    <Route element={<ProtectedRoute requiredSubmodule="control_ingreso" />}>
                      <Route path="/control-ingreso" element={<ControlIngresoPage />} />
                      <Route path="/control-ingreso/historial" element={<HistorialIngresosPage />} />
                      <Route path="/control-ingreso/ingresos-hoy" element={<Navigate to="/control-ingreso/historial" replace />} />
                      <Route path="/control-ingreso/pantalla-tv" element={<PantallaTvConfigPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="caja" />}>
                      <Route path="/caja" element={<CajaPage />} />
                      <Route path="/caja/punto-de-venta" element={<PuntoDeVentaPage />} />
                      <Route path="/caja/historial" element={<HistorialTurnosPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="deportistas" />}>
                      <Route path="/deportistas" element={<DeportistasPage />} />
                      <Route path="/deportistas/mediciones" element={<MedicionesPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="membresias" />}>
                      <Route path="/membresias" element={<MembresiasPage tabInicial="membresias" />} />
                      <Route path="/membresias/planes" element={<MembresiasPage tabInicial="planes" />} />
                      <Route path="/membresias/avisos" element={<AvisosVencimientoPage />} />
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

                    <Route element={<ProtectedRoute requiredSubmodule="gastos" />}>
                      <Route path="/gastos" element={<GastosPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="reportes" />}>
                      <Route path="/reportes" element={<ReporteIngresosPage />} />
                      <Route path="/reportes/membresias" element={<ReporteMembresiasPage />} />
                      <Route path="/reportes/asistencia" element={<ReporteAsistenciaPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="personal" />}>
                      <Route path="/personal" element={<StaffPage />} />
                      <Route path="/personal/turnos" element={<TurnosTrabajoPage />} />
                      <Route path="/personal/permisos" element={<PersonalPage />} />
                    </Route>

                    <Route element={<ProtectedRoute requiredSubmodule="configuracion" />}>
                      <Route path="/configuracion" element={<ConfigGeneralPage />} />
                      <Route path="/configuracion/landing" element={<ConfigLandingPage />} />
                      <Route path="/configuracion/metodos-pago" element={<Navigate to="/configuracion" replace />} />
                      <Route path="/configuracion/parametros" element={<Navigate to="/configuracion" replace />} />
                    </Route>

                    {/* Mi suscripción: solo el Jefe (contrato 2.6) */}
                    <Route element={<ProtectedRoute soloJefe />}>
                      <Route path="/configuracion/suscripcion" element={<MiSuscripcionPage />} />
                      {/* Carga inicial de clientes: solo el Jefe (contrato 2.4) */}
                      <Route path="/configuracion/carga-inicial" element={<CargaInicialPage />} />
                    </Route>

                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/inicio" replace />} />
            </Routes>
          </AuthProvider>
        </TenantThemeProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
