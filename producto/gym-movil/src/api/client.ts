import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TenantTheme } from '../theme/types';

const STORAGE_TOKEN_KEY = '@gymos_jwt_token';
const STORAGE_TENANT_ID_KEY = '@gymos_current_tenant_id';

// URL base adaptable para emuladores Android (10.0.2.2) y simulador iOS (localhost)
const getApiBaseUrl = (): string => {
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

export interface LoginResponse {
  access_token: string;
  deportista: {
    id: string;
    cuenta_id: string;
    gimnasio_id: string;
    gimnasio_nombre: string;
    nombre: string;
    correo: string;
    documento: string;
    telefono?: string;
  };
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
  login: async (correo: string, password: string): Promise<LoginResponse> => {
    const res = await apiClient.post<LoginResponse>('/portal/auth/login', { correo, password });
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
