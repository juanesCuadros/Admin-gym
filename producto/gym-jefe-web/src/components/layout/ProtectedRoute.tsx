import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { SinPermiso } from '../estados/Estados';
import { STORAGE } from '../../api/client';

interface ProtectedRouteProps {
  /** Clave de la matriz de permisos. Bloquea la ruta aunque se escriba la URL a mano (§A5, capa 2). */
  requiredSubmodule?: string;
  requiredAction?: 'leer' | 'crear' | 'editar' | 'eliminar';
  /** Rutas que solo el Jefe puede abrir (p. ej. Auditoría). */
  soloJefe?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  requiredSubmodule,
  requiredAction = 'leer',
  soloJefe = false,
}) => {
  const { isAuthenticated, hasPermission, isJefe } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Conserva la ruta para volver después del login (§A2 · Sesión expirada).
    const destino = `${location.pathname}${location.search}`;
    if (destino !== '/') sessionStorage.setItem(STORAGE.returnTo, destino);
    return <Navigate to="/login" replace state={{ from: destino }} />;
  }

  if (soloJefe && !isJefe) return <SinPermiso />;

  if (requiredSubmodule && !hasPermission(requiredSubmodule, requiredAction)) return <SinPermiso />;

  return <Outlet />;
};
