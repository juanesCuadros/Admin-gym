import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, ResolverCorreoResponse, tenantApi } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

export type AppFlowState = 'prelogin' | 'login' | 'service_unavailable' | 'authenticated';

interface UserProfile {
  id: string;
  nombre: string;
  correo: string;
  documento: string;
  gimnasio_id: string;
  gimnasio_nombre: string;
}

interface AuthContextValue {
  flowState: AppFlowState;
  user: UserProfile | null;
  savedEmail: string;
  resolvedTenant: ResolverCorreoResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
  resolverCorreo: (correo: string) => Promise<boolean>;
  iniciarSesion: (password: string) => Promise<boolean>;
  cerrarSesion: () => Promise<void>;
  volverAPreLogin: () => void;
  clearError: () => void;
}

const STORAGE_USER_KEY = '@gymos_user_profile';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setTenantTheme, resetTheme } = useTheme();

  const [flowState, setFlowState] = useState<AppFlowState>('prelogin');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [savedEmail, setSavedEmail] = useState<string>('');
  const [resolvedTenant, setResolvedTenant] = useState<ResolverCorreoResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Restaurar sesión al abrir la app
  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const token = await authApi.obtenerToken();
        const savedUser = await AsyncStorage.getItem(STORAGE_USER_KEY);
        if (token && savedUser) {
          setUser(JSON.parse(savedUser));
          setFlowState('authenticated');
        }
      } catch (e) {
        console.warn('[AuthContext] Error restaurando sesión:', e);
      } finally {
        setIsLoading(false);
      }
    };
    checkActiveSession();
  }, []);

  const clearError = () => setErrorMessage(null);

  // Paso 4.1: Resolución de Tenant en Pre-registro por correo
  const resolverCorreo = async (correo: string): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await tenantApi.resolverCorreo(correo);
      setSavedEmail(correo);
      setResolvedTenant(data);

      // Inyección inmediata de marca: Dynamic White-Labeling (Sección 4.3)
      await setTenantTheme({
        tenant_id: data.tenant_id,
        gym_name: data.gym_name,
        logo_url: data.logo_url,
        primary_color: data.primary_color,
        secondary_color: data.secondary_color,
        accent_color: data.accent_color,
        subdominio: data.subdominio,
        app_movil_activa: data.app_movil_activa,
      });

      // Validación del Add-on de Servicio Adicional
      if (!data.app_movil_activa) {
        setFlowState('service_unavailable');
        return false;
      }

      setFlowState('login');
      return true;
    } catch (err: any) {
      const msg =
        err.response?.data?.detail?.mensaje ||
        'No se pudo verificar el correo. Confirma que tu gimnasio esté registrado.';
      setErrorMessage(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Paso 4.1: Autenticación con credenciales y firma JWT con claims
  const iniciarSesion = async (password: string): Promise<boolean> => {
    if (!savedEmail || !resolvedTenant) return false;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authApi.login(savedEmail, password);
      await authApi.guardarSesion(res.access_token, resolvedTenant.tenant_id);

      const profile: UserProfile = {
        id: res.deportista.id,
        nombre: res.deportista.nombre,
        correo: res.deportista.correo,
        documento: res.deportista.documento,
        gimnasio_id: res.deportista.gimnasio_id,
        gimnasio_nombre: res.deportista.gimnasio_nombre,
      };

      await AsyncStorage.setItem(STORAGE_USER_KEY, JSON.stringify(profile));
      setUser(profile);
      setFlowState('authenticated');
      return true;
    } catch (err: any) {
      const msg =
        err.response?.data?.detail?.mensaje ||
        'Contraseña incorrecta o credenciales no válidas.';
      setErrorMessage(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const cerrarSesion = async () => {
    await authApi.eliminarSesion();
    await AsyncStorage.removeItem(STORAGE_USER_KEY);
    await resetTheme();
    setUser(null);
    setSavedEmail('');
    setResolvedTenant(null);
    setFlowState('prelogin');
  };

  const volverAPreLogin = () => {
    setErrorMessage(null);
    setFlowState('prelogin');
  };

  return (
    <AuthContext.Provider
      value={{
        flowState,
        user,
        savedEmail,
        resolvedTenant,
        isLoading,
        errorMessage,
        resolverCorreo,
        iniciarSesion,
        cerrarSesion,
        volverAPreLogin,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
};
