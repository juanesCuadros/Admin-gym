import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActualizarPerfilPayload,
  authApi,
  extractApiError,
  FotoPerfilResponse,
  PerfilDeportistaResponse,
  RegistrarMedicionPayload,
  ResolverCorreoResponse,
  tenantApi,
} from '../api/client';
import { useTheme } from '../theme/ThemeContext';

export type AppFlowState =
  | 'prelogin'
  | 'service_unavailable'
  | 'pin'
  | 'set_password'
  | 'onboarding_personal'
  | 'onboarding_measurements'
  | 'login'
  | 'authenticated';

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
  perfil: PerfilDeportistaResponse | null;
  avatarDataUrl: string | null;
  savedEmail: string;
  resolvedTenant: ResolverCorreoResponse | null;
  esPrimerIngreso: boolean;
  infoMessage: string | null;
  isLoading: boolean;
  isBooting: boolean;
  errorMessage: string | null;
  resolverCorreo: (correo: string) => Promise<boolean>;
  validarPin: (pin: string) => Promise<boolean>;
  reenviarPin: () => Promise<boolean>;
  solicitarRecuperacionPin: () => Promise<boolean>;
  crearPassword: (password: string, confirmacion: string) => Promise<boolean>;
  confirmarDatosPersonales: (payload: ActualizarPerfilPayload) => Promise<boolean>;
  actualizarDatosPerfil: (payload: ActualizarPerfilPayload) => Promise<PerfilDeportistaResponse>;
  subirFotoPerfil: (fotoBase64: string) => Promise<FotoPerfilResponse>;
  eliminarFotoPerfil: () => Promise<void>;
  guardarMedidasIniciales: (payload: RegistrarMedicionPayload) => Promise<boolean>;
  omitirMedidas: () => void;
  iniciarSesion: (password: string) => Promise<boolean>;
  recargarPerfil: () => Promise<void>;
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
  const [perfil, setPerfil] = useState<PerfilDeportistaResponse | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [savedEmail, setSavedEmail] = useState<string>('');
  const [resolvedTenant, setResolvedTenant] = useState<ResolverCorreoResponse | null>(null);
  const [setupToken, setSetupToken] = useState<string>('');
  const [esPrimerIngreso, setEsPrimerIngreso] = useState<boolean>(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cargarFotoSiExiste = async (tieneFoto?: boolean) => {
    if (!tieneFoto) {
      setAvatarDataUrl(null);
      return;
    }
    try {
      const f = await authApi.obtenerFotoPerfil();
      setAvatarDataUrl(f.tiene_foto && f.data_url ? f.data_url : null);
    } catch {
      // Silencioso si no tiene foto
    }
  };

  useEffect(() => {
    const checkActiveSession = async () => {
      try {
        const token = await authApi.obtenerToken();
        const savedUser = await AsyncStorage.getItem(STORAGE_USER_KEY);
        if (token && savedUser) {
          const parsedUser: UserProfile = JSON.parse(savedUser);
          setUser(parsedUser);
          try {
            const p = await authApi.obtenerPerfil();
            setPerfil(p);
            await cargarFotoSiExiste(p.tiene_foto);
          } catch {
            await authApi.eliminarSesion();
            await AsyncStorage.removeItem(STORAGE_USER_KEY);
            setUser(null);
            setFlowState('prelogin');
            return;
          }
          setFlowState('authenticated');
        }
      } catch (e) {
        console.warn('[AuthContext] Error restaurando sesión:', e);
      } finally {
        setIsBooting(false);
      }
    };
    checkActiveSession();
  }, []);

  const clearError = () => setErrorMessage(null);

  const resolverCorreo = async (correo: string): Promise<boolean> => {
    const correoLimpio = correo.trim().toLowerCase();
    setIsLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const data = await tenantApi.resolverCorreo(correoLimpio);
      setSavedEmail(correoLimpio);
      setResolvedTenant(data);
      setEsPrimerIngreso(data.requiere_activacion);

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

      if (!data.app_movil_activa) {
        setFlowState('service_unavailable');
        return false;
      }

      const inicio = await authApi.iniciarAcceso(correoLimpio, data.subdominio, false);
      setInfoMessage(inicio.mensaje);

      if (inicio.paso_siguiente === 'pin') {
        setEsPrimerIngreso(true);
        setFlowState('pin');
      } else {
        setEsPrimerIngreso(false);
        setFlowState('login');
      }
      return true;
    } catch (err: any) {
      setErrorMessage(
        extractApiError(
          err,
          'No se encontró un deportista activo con este correo. Verifica que estés inscrito en tu gimnasio.'
        )
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const reenviarPin = async (): Promise<boolean> => {
    if (!savedEmail || !resolvedTenant) return false;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authApi.iniciarAcceso(savedEmail, resolvedTenant.subdominio, true);
      setInfoMessage(res.mensaje || 'Te enviamos un nuevo código de 6 dígitos a tu correo.');
      setFlowState('pin');
      return true;
    } catch (err: any) {
      setErrorMessage(extractApiError(err, 'No se pudo reenviar el código. Intenta en unos minutos.'));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const solicitarRecuperacionPin = async (): Promise<boolean> => {
    setEsPrimerIngreso(false);
    return reenviarPin();
  };

  const validarPin = async (pin: string): Promise<boolean> => {
    if (!savedEmail || !resolvedTenant) return false;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authApi.validarPin(savedEmail, pin.trim(), resolvedTenant.subdominio);
      setSetupToken(res.setup_token);
      setInfoMessage(res.mensaje);
      setFlowState('set_password');
      return true;
    } catch (err: any) {
      setErrorMessage(extractApiError(err, 'El código ingresado es incorrecto o ha expirado.'));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const crearPassword = async (password: string, confirmacion: string): Promise<boolean> => {
    if (!setupToken || !resolvedTenant) return false;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authApi.establecerPassword(setupToken, password, confirmacion);
      await authApi.guardarSesion(res.access_token, res.deportista.gimnasio_id);

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
      setSetupToken('');

      const p = await authApi.obtenerPerfil();
      setPerfil(p);
      await cargarFotoSiExiste(p.tiene_foto);

      if (esPrimerIngreso) {
        setFlowState('onboarding_personal');
      } else {
        setFlowState('authenticated');
      }
      return true;
    } catch (err: any) {
      setErrorMessage(extractApiError(err, 'No se pudo guardar tu contraseña. Verifica los requisitos.'));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const actualizarDatosPerfil = async (payload: ActualizarPerfilPayload): Promise<PerfilDeportistaResponse> => {
    const updated = await authApi.actualizarPerfil(payload);
    setPerfil(updated);
    if (user) {
      const updatedUser: UserProfile = { ...user, nombre: updated.nombre };
      setUser(updatedUser);
      await AsyncStorage.setItem(STORAGE_USER_KEY, JSON.stringify(updatedUser));
    }
    return updated;
  };

  const confirmarDatosPersonales = async (payload: ActualizarPerfilPayload): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await actualizarDatosPerfil(payload);
      setFlowState('onboarding_measurements');
      return true;
    } catch (err: any) {
      setErrorMessage(extractApiError(err, 'Revisa los datos personales ingresados.'));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const subirFotoPerfil = async (fotoBase64: string): Promise<FotoPerfilResponse> => {
    const res = await authApi.subirFotoPerfil(fotoBase64);
    setAvatarDataUrl(res.data_url || null);
    setPerfil((prev) => (prev ? { ...prev, tiene_foto: true } : prev));
    return res;
  };

  const eliminarFotoPerfil = async (): Promise<void> => {
    await authApi.eliminarFotoPerfil();
    setAvatarDataUrl(null);
    setPerfil((prev) => (prev ? { ...prev, tiene_foto: false } : prev));
  };

  const guardarMedidasIniciales = async (payload: RegistrarMedicionPayload): Promise<boolean> => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await authApi.registrarMedicion(payload);
      const updated = await authApi.obtenerPerfil();
      setPerfil(updated);
      setFlowState('authenticated');
      return true;
    } catch (err: any) {
      setErrorMessage(extractApiError(err, 'Revisa los valores de tus medidas corporales.'));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const omitirMedidas = () => {
    setErrorMessage(null);
    setFlowState('authenticated');
  };

  const iniciarSesion = async (password: string): Promise<boolean> => {
    if (!savedEmail || !resolvedTenant) return false;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await authApi.login(savedEmail, password, resolvedTenant.subdominio);
      await authApi.guardarSesion(res.access_token, res.deportista.gimnasio_id);

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

      const p = await authApi.obtenerPerfil();
      setPerfil(p);
      await cargarFotoSiExiste(p.tiene_foto);
      setFlowState('authenticated');
      return true;
    } catch (err: any) {
      setErrorMessage(extractApiError(err, 'Contraseña incorrecta o credenciales no válidas.'));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const recargarPerfil = async () => {
    try {
      const p = await authApi.obtenerPerfil();
      setPerfil(p);
      await cargarFotoSiExiste(p.tiene_foto);
    } catch (e) {
      console.warn('[AuthContext] Error recargando perfil:', e);
    }
  };

  const cerrarSesion = async () => {
    await authApi.eliminarSesion();
    await AsyncStorage.removeItem(STORAGE_USER_KEY);
    await resetTheme();
    setUser(null);
    setPerfil(null);
    setAvatarDataUrl(null);
    setSavedEmail('');
    setResolvedTenant(null);
    setSetupToken('');
    setInfoMessage(null);
    setErrorMessage(null);
    setFlowState('prelogin');
  };

  const volverAPreLogin = () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setSetupToken('');
    setFlowState('prelogin');
  };

  return (
    <AuthContext.Provider
      value={{
        flowState,
        user,
        perfil,
        avatarDataUrl,
        savedEmail,
        resolvedTenant,
        esPrimerIngreso,
        infoMessage,
        isLoading,
        isBooting,
        errorMessage,
        resolverCorreo,
        validarPin,
        reenviarPin,
        solicitarRecuperacionPin,
        crearPassword,
        confirmarDatosPersonales,
        actualizarDatosPerfil,
        subirFotoPerfil,
        eliminarFotoPerfil,
        guardarMedidasIniciales,
        omitirMedidas,
        iniciarSesion,
        recargarPerfil,
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
