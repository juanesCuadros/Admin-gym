import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingSpinner } from '../ui/Table';

interface ProtectedRouteProps {
  requiredSubmodule?: string;
  requiredAction?: 'leer' | 'crear' | 'editar' | 'eliminar';
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  requiredSubmodule,
  requiredAction,
}) => {
  const { isAuthenticated, isLoading, hasPermission } = useAuth();

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner size={36} label="Cargando sesión..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredSubmodule && !hasPermission(requiredSubmodule, requiredAction)) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h3 style={{ color: 'var(--danger)', marginBottom: 8 }}>Acceso Restringido</h3>
        <p style={{ color: 'var(--text-secondary)' }}>
          No tienes permisos configurados para acceder a este submódulo ({requiredSubmodule}).
        </p>
      </div>
    );
  }

  return <Outlet />;
};
