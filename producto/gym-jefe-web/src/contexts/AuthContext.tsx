import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { UsuarioAuthDto, LoginRequest } from '../types/auth.types';
import { authService } from '../api/auth.service';
import { ApiError, EVENTOS, STORAGE, expirarSesion, limpiarSesionLocal, toApiError } from '../api/client';

/**
 * Duración de sesión por inactividad (§C6). Debería venir del parámetro del gimnasio
 * (GW-RF-48, 15 min – 8 h); el backend aún no lo expone, así que aplica el valor por defecto: 1 h.
 */
const INACTIVIDAD_MS = 60 * 60 * 1000;
const EVENTOS_ACTIVIDAD = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;

/** Motivo por el que se terminó la última sesión; el login lo muestra como mensaje fijo. */
export type MotivoFinSesion = 'expirada' | 'inactividad' | 'cerrada' | null;
const STORAGE_MOTIVO = 'gymos_motivo_fin_sesion';

export type ResultadoLogin = { ok: true; usuario: UsuarioAuthDto } | { ok: false; error: ApiError };

interface AuthContextType {
  user: UsuarioAuthDto | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginRequest) => Promise<ResultadoLogin>;
  logout: () => Promise<void>;
  /** Vuelve a pedir `/auth/me` para refrescar permisos (p. ej. tras un 403). */
  refrescarUsuario: () => Promise<void>;
  hasPermission: (submodulo: string, accion?: 'leer' | 'crear' | 'editar' | 'eliminar') => boolean;
  isJefe: boolean;
  isRecepcionista: boolean;
  isEntrenador: boolean;
  /** Lee y limpia el motivo del último fin de sesión. */
  consumirMotivoFinSesion: () => MotivoFinSesion;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function leerUsuarioGuardado(): UsuarioAuthDto | null {
  const token = localStorage.getItem(STORAGE.access);
  const raw = localStorage.getItem(STORAGE.user);
  if (!token || !raw) return null;
  try {
    return JSON.parse(raw) as UsuarioAuthDto;
  } catch {
    limpiarSesionLocal();
    return null;
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UsuarioAuthDto | null>(() => leerUsuarioGuardado());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const timerInactividad = useRef<number | null>(null);

  // Fin de sesión disparado por el interceptor (401 sin refresh, refresh fallido, usuario inactivo)
  // o gimnasio suspendido (la sesión local ya fue limpiada; aquí solo se suelta el estado).
  useEffect(() => {
    const onExpirada = () => {
      if (!sessionStorage.getItem(STORAGE_MOTIVO)) sessionStorage.setItem(STORAGE_MOTIVO, 'expirada');
      setUser(null);
    };
    const onSuspendido = () => setUser(null);
    window.addEventListener(EVENTOS.sesionExpirada, onExpirada);
    window.addEventListener(EVENTOS.gimnasioSuspendido, onSuspendido);
    return () => {
      window.removeEventListener(EVENTOS.sesionExpirada, onExpirada);
      window.removeEventListener(EVENTOS.gimnasioSuspendido, onSuspendido);
    };
  }, []);

  // Expiración por inactividad (§C6).
  useEffect(() => {
    if (!user) return;

    const vencer = () => {
      sessionStorage.setItem(STORAGE_MOTIVO, 'inactividad');
      expirarSesion();
    };
    const reiniciar = () => {
      if (timerInactividad.current) window.clearTimeout(timerInactividad.current);
      timerInactividad.current = window.setTimeout(vencer, INACTIVIDAD_MS);
    };

    reiniciar();
    EVENTOS_ACTIVIDAD.forEach((ev) => window.addEventListener(ev, reiniciar, { passive: true }));
    return () => {
      if (timerInactividad.current) window.clearTimeout(timerInactividad.current);
      EVENTOS_ACTIVIDAD.forEach((ev) => window.removeEventListener(ev, reiniciar));
    };
  }, [user]);

  const login = async (credentials: LoginRequest): Promise<ResultadoLogin> => {
    setIsLoading(true);
    try {
      const res = await authService.login(credentials);
      localStorage.setItem(STORAGE.access, res.access_token);
      localStorage.setItem(STORAGE.refresh, res.refresh_token);
      localStorage.setItem(STORAGE.user, JSON.stringify(res.usuario));
      localStorage.setItem(STORAGE.subdominio, res.usuario.subdominio);
      sessionStorage.removeItem(STORAGE_MOTIVO);
      setUser(res.usuario);
      return { ok: true, usuario: res.usuario };
    } catch (err) {
      return { ok: false, error: toApiError(err) };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem(STORAGE.refresh);
    if (refreshToken) {
      try {
        await authService.logout(refreshToken);
      } catch (e) {
        // La sesión local se limpia igual; el refresh vence solo en el servidor.
        console.warn('No se pudo revocar el refresh token en el servidor', e);
      }
    }
    limpiarSesionLocal();
    sessionStorage.removeItem(STORAGE.returnTo);
    sessionStorage.setItem(STORAGE_MOTIVO, 'cerrada');
    setUser(null);
  };

  const refrescarUsuario = useCallback(async () => {
    try {
      const me = await authService.getMe();
      localStorage.setItem(STORAGE.user, JSON.stringify(me));
      setUser(me);
    } catch {
      // Si falla, el interceptor ya decidió (sesión expirada / suspendido). No hay nada más que hacer aquí.
    }
  }, []);

  const hasPermission = useCallback(
    (submodulo: string, accion?: 'leer' | 'crear' | 'editar' | 'eliminar'): boolean => {
      if (!user) return false;
      if (user.rol === 'jefe') return true;
      if (user.permisos.includes('*')) return true;
      if (!accion) return user.permisos.some((p) => p.startsWith(`${submodulo}:`));
      return user.permisos.includes(`${submodulo}:${accion}`) || user.permisos.includes(`${submodulo}:*`);
    },
    [user]
  );

  const consumirMotivoFinSesion = (): MotivoFinSesion => {
    const m = sessionStorage.getItem(STORAGE_MOTIVO) as MotivoFinSesion;
    sessionStorage.removeItem(STORAGE_MOTIVO);
    return m ?? null;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        refrescarUsuario,
        hasPermission,
        isJefe: user?.rol === 'jefe',
        isRecepcionista: user?.rol === 'recepcionista',
        isEntrenador: user?.rol === 'entrenador',
        consumirMotivoFinSesion,
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
