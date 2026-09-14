import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './contexts/ToastContext';
import { TenantThemeProvider } from './contexts/TenantThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

// Pages
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ControlIngresoPage } from './pages/controlIngreso/ControlIngresoPage';
import { PantallaTvPage } from './pages/pantallaTv/PantallaTvPage';
import { CajaPage } from './pages/caja/CajaPage';
import { DeportistasPage } from './pages/deportistas/DeportistasPage';
import { MembresiasPage } from './pages/membresias/MembresiasPage';
import { EntrenamientoPage } from './pages/entrenamiento/EntrenamientoPage';
import { ClasesPage } from './pages/clases/ClasesPage';
import { InventarioPage } from './pages/inventario/InventarioPage';
import { PersonalPage } from './pages/personal/PersonalPage';
import { ReportesPage } from './pages/reportes/ReportesPage';
import { ConfiguracionPage } from './pages/configuracion/ConfiguracionPage';

import './styles/components.css';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <TenantThemeProvider>
          <AuthProvider>
            <Routes>
              {/* Public & TV lobby routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/pantalla-tv" element={<PantallaTvPage />} />
              <Route path="/tv/:subdominio" element={<PantallaTvPage />} />

              {/* Protected Staff Application Layout */}
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/control-ingreso" element={<ControlIngresoPage />} />
                  <Route path="/caja" element={<CajaPage />} />
                  <Route path="/deportistas" element={<DeportistasPage />} />
                  <Route path="/membresias" element={<MembresiasPage />} />
                  <Route path="/entrenamiento" element={<EntrenamientoPage />} />
                  <Route path="/clases" element={<ClasesPage />} />
                  <Route path="/inventario" element={<InventarioPage />} />
                  <Route path="/personal" element={<PersonalPage />} />
                  <Route path="/reportes" element={<ReportesPage />} />
                  <Route path="/configuracion" element={<ConfiguracionPage />} />
                </Route>
              </Route>

              {/* Catch-all redirect */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </TenantThemeProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
