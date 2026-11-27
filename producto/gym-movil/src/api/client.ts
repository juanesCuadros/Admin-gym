import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TenantTheme } from '../theme/types';

const STORAGE_TOKEN_KEY = '@gymos_jwt_token';
const STORAGE_TENANT_ID_KEY = '@gymos_current_tenant_id';

// URL base adaptable para Túnel Expo (iPhone/Android físico sin bloqueo de firewall), LAN, Web y emuladores
const getApiBaseUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'web') {
    return '/api/v1';
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const cleanHost = hostUri.replace(/^(exp|https?):\/\//, '').replace(/\/.*$/, '');
    const [hostname, port] = cleanHost.split(':');
    if (
      cleanHost.includes('.exp.direct') ||
      cleanHost.includes('.expo.dev') ||
      cleanHost.includes('.ngrok') ||
      !port ||
      port === '443' ||
      port === '80'
    ) {
      return `https://${hostname}/api/v1`;
    }
    return `http://${cleanHost}/api/v1`;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000/api/v1';
  }
  return 'http://localhost:8000/api/v1';
};

export const apiClient: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Interceptor de Peticiones: Inyecta Authorization Bearer y X-Tenant-Id (Sección 4.2)
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      const token = await AsyncStorage.getItem(STORAGE_TOKEN_KEY);
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      const tenantId = await AsyncStorage.getItem(STORAGE_TENANT_ID_KEY);
      if (tenantId && config.headers) {
        config.headers['X-Tenant-Id'] = tenantId;
      }
    } catch (e) {
      console.warn('[apiClient] Error leyendo credenciales:', e);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export const extractApiError = (err: any, fallback: string): string => {
  const data = err?.response?.data;
  if (data?.error?.mensaje) {
    const detalles = data.error.detalles;
    if (Array.isArray(detalles) && detalles.length > 0 && detalles[0]?.msg) {
      return String(detalles[0].msg).replace(/^Value error,\s*/i, '');
    }
    return data.error.mensaje;
  }
  if (data?.detail) {
    if (typeof data.detail === 'string') return data.detail;
    if (data.detail?.mensaje) return data.detail.mensaje;
    if (Array.isArray(data.detail) && data.detail.length > 0 && data.detail[0]?.msg) {
      return String(data.detail[0].msg).replace(/^Value error,\s*/i, '');
    }
  }
  return fallback;
};

export interface ResolverCorreoResponse {
  tenant_id: string;
  gym_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  subdominio: string;
  app_movil_activa: boolean;
  usuario_existe: boolean;
  requiere_activacion: boolean;
}

export interface IniciarAccesoResponse {
  paso_siguiente: 'pin' | 'password';
  correo: string;
  mensaje: string;
  vigencia_minutos: number;
}

export interface ValidarPinResponse {
  valido: boolean;
  setup_token: string;
  mensaje: string;
}

export interface DeportistaAuthDto {
  id: string;
  cuenta_id: string;
  gimnasio_id: string;
  gimnasio_nombre: string;
  subdominio: string;
  nombre: string;
  documento: string;
  correo: string;
  telefono?: string | null;
}

export interface LoginResponse {
  access_token: string;
  deportista: DeportistaAuthDto;
}

export interface MembresiaResumenDto {
  id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  dias_restantes: number;
  estado: string;
  congelada: boolean;
  precio: number | string;
}

export interface PerfilDeportistaResponse {
  id: string;
  gimnasio_nombre: string;
  subdominio: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  sexo?: 'M' | 'F' | 'otro' | null;
  fecha_nacimiento?: string | null;
  altura_cm?: number | string | null;
  acudiente_nombre?: string | null;
  estado_general: string;
  membresia_actual?: MembresiaResumenDto | null;
  total_asistencias_mes: number;
  total_asistencias_historico: number;
  ultimo_peso_kg?: number | string | null;
  ultimo_grasa_pct?: number | string | null;
  ultimo_masa_muscular_kg?: number | string | null;
  tiene_foto?: boolean;
  version: number;
}

export interface FotoPerfilResponse {
  tiene_foto: boolean;
  data_url?: string | null;
  media_type?: string | null;
  bytes_size: number;
}

export interface ActualizarPerfilPayload {
  nombre: string;
  telefono?: string | null;
  sexo?: 'M' | 'F' | 'otro' | null;
  fecha_nacimiento?: string | null;
  altura_cm?: number | null;
  acudiente_nombre?: string | null;
}

export interface RegistrarMedicionPayload {
  fecha?: string;
  sexo?: 'M' | 'F';
  altura_cm?: number;
  peso: number;
  cintura?: number;
  cadera?: number;
  pecho?: number;
  brazo?: number;
  pierna?: number;
}

export interface MedicionPortalItem {
  id: string;
  fecha: string;
  peso?: number | string | null;
  imc?: number | string | null;
  grasa_pct?: number | string | null;
  masa_muscular?: number | string | null;
  cintura?: number | string | null;
  cadera?: number | string | null;
  pecho?: number | string | null;
  brazo?: number | string | null;
  pierna?: number | string | null;
  origen: 'deportista' | 'staff';
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface ProgresoResumenDto {
  total_registros: number;
  peso_inicial?: number | string | null;
  peso_actual?: number | string | null;
  cambio_peso?: number | string | null;
  grasa_inicial?: number | string | null;
  grasa_actual?: number | string | null;
  cambio_grasa?: number | string | null;
  musculo_inicial?: number | string | null;
  musculo_actual?: number | string | null;
  cambio_musculo?: number | string | null;
  cintura_inicial?: number | string | null;
  cintura_actual?: number | string | null;
  cambio_cintura?: number | string | null;
  imc_actual?: number | string | null;
  altura_cm?: number | string | null;
  sexo?: string | null;
}

export interface MedicionesPortalResponse {
  resumen: ProgresoResumenDto;
  historial: MedicionPortalItem[];
}

export interface AsistenciaPortalItem {
  id: number;
  fecha_hora: string;
  fecha_local: string;
  hora_local: string;
  metodo: string;
  resultado: string;
}

export interface AsistenciasPortalResponse {
  asistencias_mes_actual: number;
  asistencias_ultimos_30_dias: number;
  asistencias_totales: number;
  dias_asistidos_mes: string[];
  historial: AsistenciaPortalItem[];
}

export const tenantApi = {
  resolverCorreo: async (correo: string): Promise<ResolverCorreoResponse> => {
    const res = await apiClient.post<ResolverCorreoResponse>('/tenant/resolver-correo', { correo });
    return res.data;
  },
  obtenerTema: async (tenantId?: string): Promise<TenantTheme> => {
    const headers = tenantId ? { 'X-Tenant-Id': tenantId } : undefined;
    const res = await apiClient.get<TenantTheme>('/tenant/config/theme', { headers });
    return res.data;
  },
};

export const authApi = {
  iniciarAcceso: async (
    correo: string,
    subdominio: string,
    forzar_pin = false
  ): Promise<IniciarAccesoResponse> => {
    const res = await apiClient.post<IniciarAccesoResponse>('/portal/auth/iniciar', {
      correo,
      subdominio,
      forzar_pin,
    });
    return res.data;
  },
  validarPin: async (
    correo: string,
    pin: string,
    subdominio: string
  ): Promise<ValidarPinResponse> => {
    const res = await apiClient.post<ValidarPinResponse>('/portal/auth/validar-pin', {
      correo,
      pin,
      subdominio,
    });
    return res.data;
  },
  establecerPassword: async (
    setup_token: string,
    password: string,
    password_confirmacion: string
  ): Promise<LoginResponse> => {
    const res = await apiClient.post<LoginResponse>('/portal/auth/establecer-password', {
      setup_token,
      password,
      password_confirmacion,
    });
    return res.data;
  },
  login: async (correo: string, password: string, subdominio: string): Promise<LoginResponse> => {
    const res = await apiClient.post<LoginResponse>('/portal/auth/login', {
      correo,
      password,
      subdominio,
    });
    return res.data;
  },
  obtenerPerfil: async (): Promise<PerfilDeportistaResponse> => {
    const res = await apiClient.get<PerfilDeportistaResponse>('/portal/perfil');
    return res.data;
  },
  actualizarPerfil: async (payload: ActualizarPerfilPayload): Promise<PerfilDeportistaResponse> => {
    const res = await apiClient.patch<PerfilDeportistaResponse>('/portal/perfil', payload);
    return res.data;
  },
  obtenerFotoPerfil: async (): Promise<FotoPerfilResponse> => {
    const res = await apiClient.get<FotoPerfilResponse>('/portal/perfil/foto');
    return res.data;
  },
  subirFotoPerfil: async (foto_base64: string): Promise<FotoPerfilResponse> => {
    const res = await apiClient.put<FotoPerfilResponse>('/portal/perfil/foto', { foto_base64 });
    return res.data;
  },
  eliminarFotoPerfil: async (): Promise<FotoPerfilResponse> => {
    const res = await apiClient.delete<FotoPerfilResponse>('/portal/perfil/foto');
    return res.data;
  },
  obtenerMediciones: async (): Promise<MedicionesPortalResponse> => {
    const res = await apiClient.get<MedicionesPortalResponse>('/portal/mediciones');
    return res.data;
  },
  obtenerAsistencias: async (): Promise<AsistenciasPortalResponse> => {
    const res = await apiClient.get<AsistenciasPortalResponse>('/portal/asistencias');
    return res.data;
  },
  registrarMedicion: async (payload: RegistrarMedicionPayload): Promise<MedicionPortalItem> => {
    const res = await apiClient.post<MedicionPortalItem>('/portal/mediciones', payload);
    return res.data;
  },
  guardarSesion: async (token: string, tenantId: string): Promise<void> => {
    await AsyncStorage.multiSet([
      [STORAGE_TOKEN_KEY, token],
      [STORAGE_TENANT_ID_KEY, tenantId],
    ]);
  },
  eliminarSesion: async (): Promise<void> => {
    await AsyncStorage.multiRemove([STORAGE_TOKEN_KEY, STORAGE_TENANT_ID_KEY]);
  },
  obtenerToken: async (): Promise<string | null> => {
    return AsyncStorage.getItem(STORAGE_TOKEN_KEY);
  },
};
