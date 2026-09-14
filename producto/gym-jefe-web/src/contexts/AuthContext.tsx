import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { UsuarioAuthDto, LoginRequest } from '../types/auth.types';
import { authService } from '../api/auth.service';
import { useToast } from './ToastContext';
import { parseApiError } from '../api/client';

interface AuthContextType {
  user: UsuarioAuthDto | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<boolean>;
  loginDemo: (role: 'jefe' | 'recepcionista' | 'entrenador', subdominio?: string) => void;
  logout: () => Promise<void>;
  hasPermission: (submodulo: string, accion?: 'leer' | 'crear' | 'editar' | 'eliminar') => boolean;
  isJefe: boolean;
  isRecepcionista: boolean;
  isEntrenador: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UsuarioAuthDto | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { showToast } = useToast();

  // Load session from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('gymos_access_token');
    const savedUser = localStorage.getItem('gymos_user');

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error('Failed to parse saved user', e);
        localStorage.removeItem('gymos_user');
        localStorage.removeItem('gymos_access_token');
      }
    }
    setIsLoading(false);

    // Listen to session expired events from axios interceptor
    const handleSessionExpired = () => {
      setUser(null);
      setToken(null);
      showToast('error', 'Sesión expirada', 'Por favor vuelve a iniciar sesión');
    };

    window.addEventListener('gymos_session_expired', handleSessionExpired);
    return () => {
      window.removeEventListener('gymos_session_expired', handleSessionExpired);
    };
  }, [showToast]);

  const login = async (credentials: LoginRequest): Promise<boolean> => {
    try {
      setIsLoading(true);
      const res = await authService.login(credentials);

      localStorage.setItem('gymos_access_token', res.access_token);
      localStorage.setItem('gymos_refresh_token', res.refresh_token);
      localStorage.setItem('gymos_user', JSON.stringify(res.usuario));
      localStorage.setItem('gymos_tenant_subdomain', res.usuario.subdominio);

      setToken(res.access_token);
      setUser(res.usuario);

      showToast('success', `¡Bienvenido, ${res.usuario.nombre}!`, `Sesión iniciada como ${res.usuario.rol}`);
      return true;
    } catch (err) {
      const msg = parseApiError(err);
      showToast('error', 'Error al iniciar sesión', msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Demo login function for effortless exploration and instant testing
  const loginDemo = (role: 'jefe' | 'recepcionista' | 'entrenador', subdominio = 'entrena-a-e9cce5') => {
    const mockUser: UsuarioAuthDto = {
      id: '00000000-0000-0000-0000-000000000001',
      nombre: role === 'jefe' ? 'Carlos (Jefe)' : role === 'recepcionista' ? 'María (Recepción)' : 'David (Entrenador)',
      correo: `${role}@gymos.co`,
      rol: role,
      gimnasio_id: '9d8ed8dc-e879-4c43-bc84-43b80b0f0fe8',
      subdominio,
      permisos: role === 'jefe' ? ['*'] : role === 'recepcionista' ? [
        'control_ingreso:leer', 'control_ingreso:crear',
        'caja:leer', 'caja:crear', 'caja:editar',
        'deportistas:leer', 'deportistas:crear', 'deportistas:editar',
        'membresias:leer', 'membresias:crear',
        'clases:leer', 'clases:crear',
      ] : [
        'entrenamiento:leer', 'entrenamiento:crear', 'entrenamiento:editar',
        'clases:leer',
        'deportistas:leer',
      ],
    };

    const mockToken = 'mock_jwt_token_demo_gymos';
    localStorage.setItem('gymos_access_token', mockToken);
    localStorage.setItem('gymos_refresh_token', 'mock_refresh_token');
    localStorage.setItem('gymos_user', JSON.stringify(mockUser));
    localStorage.setItem('gymos_tenant_subdomain', subdominio);

    setToken(mockToken);
    setUser(mockUser);
    showToast('info', `Modo Demo: ${mockUser.nombre}`, `Explorando GymOS con perfil de ${role}`);
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('gymos_refresh_token');
    if (refreshToken && !refreshToken.startsWith('mock_')) {
      try {
        await authService.logout(refreshToken);
      } catch (e) {
        console.warn('Error during API logout call', e);
      }
    }

    localStorage.removeItem('gymos_access_token');
    localStorage.removeItem('gymos_refresh_token');
    localStorage.removeItem('gymos_user');

    setUser(null);
    setToken(null);
    showToast('info', 'Sesión cerrada', 'Has salido del sistema de forma segura');
  };

  const hasPermission = useCallback(
    (submodulo: string, accion?: 'leer' | 'crear' | 'editar' | 'eliminar'): boolean => {
      if (!user) return false;
      if (user.rol === 'jefe') return true;
      if (user.permisos.includes('*')) return true;

      if (!accion) {
        return user.permisos.some((p) => p.startsWith(`${submodulo}:`));
      }

      return (
        user.permisos.includes(`${submodulo}:${accion}`) ||
        user.permisos.includes(`${submodulo}:*`)
      );
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginDemo,
        logout,
        hasPermission,
        isJefe: user?.rol === 'jefe',
        isRecepcionista: user?.rol === 'recepcionista',
        isEntrenador: user?.rol === 'entrenador',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
