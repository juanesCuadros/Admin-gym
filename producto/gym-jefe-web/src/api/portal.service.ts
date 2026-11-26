import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { STORAGE, toApiError } from './client';
import type {
  ActualizarPerfilDeportistaRequest,
  AsistenciasPortalResponse,
  DeportistaAuthPerfilDto,
  FinanzasDeportistaResponse,
  IniciarAccesoDeportistaResponse,
  LoginDeportistaResponse,
  MedicionesPortalResponse,
  MedicionPortalItem,
  PerfilDeportistaResponse,
  RegistrarMedicionPortalRequest,
  ValidarPinDeportistaResponse,
} from '../types/portal.types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const PORTAL_STORAGE = {
  access: 'gymos_portal_access_token',
  user: 'gymos_portal_deportista',
} as const;

export const EVENTO_PORTAL_SESION_EXPIRADA = 'gymos_portal_session_expired';

export function guardarSesionPortal(res: LoginDeportistaResponse): void {
  localStorage.setItem(PORTAL_STORAGE.access, res.access_token);
  localStorage.setItem(PORTAL_STORAGE.user, JSON.stringify(res.deportista));
  if (res.deportista.subdominio) {
    localStorage.setItem(STORAGE.subdominio, res.deportista.subdominio);
  }
}

export function leerSesionPortal(): DeportistaAuthPerfilDto | null {
  const token = localStorage.getItem(PORTAL_STORAGE.access);
  const raw = localStorage.getItem(PORTAL_STORAGE.user);
  if (!token || !raw) return null;
  try {
    return JSON.parse(raw) as DeportistaAuthPerfilDto;
  } catch {
    limpiarSesionPortal();
    return null;
  }
}

export function limpiarSesionPortal(): void {
  localStorage.removeItem(PORTAL_STORAGE.access);
  localStorage.removeItem(PORTAL_STORAGE.user);
}

const portalClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

portalClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(PORTAL_STORAGE.access);
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

portalClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const apiErr = toApiError(error);
    const url = error.config?.url ?? '';
    const esAuth = url.includes('/portal/auth/');

    if (apiErr.status === 401 && !esAuth) {
      limpiarSesionPortal();
      window.dispatchEvent(new Event(EVENTO_PORTAL_SESION_EXPIRADA));
    }
    return Promise.reject(apiErr);
  },
);

export const portalService = {
  async iniciarAcceso(
    correo: string,
    subdominio: string,
    forzar_pin = false,
  ): Promise<IniciarAccesoDeportistaResponse> {
    const res = await portalClient.post<IniciarAccesoDeportistaResponse>('/portal/auth/iniciar', {
      correo: correo.trim().toLowerCase(),
      subdominio: subdominio.trim().toLowerCase(),
      forzar_pin,
    });
    return res.data;
  },

  async validarPin(
    correo: string,
    pin: string,
    subdominio: string,
  ): Promise<ValidarPinDeportistaResponse> {
    const res = await portalClient.post<ValidarPinDeportistaResponse>('/portal/auth/validar-pin', {
      correo: correo.trim().toLowerCase(),
      pin: pin.trim(),
      subdominio: subdominio.trim().toLowerCase(),
    });
    return res.data;
  },

  async establecerPassword(
    setup_token: string,
    password: string,
    password_confirmacion: string,
  ): Promise<LoginDeportistaResponse> {
    const res = await portalClient.post<LoginDeportistaResponse>('/portal/auth/establecer-password', {
      setup_token,
      password,
      password_confirmacion,
    });
    guardarSesionPortal(res.data);
    return res.data;
  },

  async loginPassword(
    correo: string,
    password: string,
    subdominio: string,
  ): Promise<LoginDeportistaResponse> {
    const res = await portalClient.post<LoginDeportistaResponse>('/portal/auth/login', {
      correo: correo.trim().toLowerCase(),
      password,
      subdominio: subdominio.trim().toLowerCase(),
    });
    guardarSesionPortal(res.data);
    return res.data;
  },

  async obtenerPerfil(): Promise<PerfilDeportistaResponse> {
    const res = await portalClient.get<PerfilDeportistaResponse>('/portal/perfil');
    return res.data;
  },

  async actualizarPerfil(data: ActualizarPerfilDeportistaRequest): Promise<PerfilDeportistaResponse> {
    const res = await portalClient.patch<PerfilDeportistaResponse>('/portal/perfil', data);
    return res.data;
  },

  async obtenerFinanzas(): Promise<FinanzasDeportistaResponse> {
    const res = await portalClient.get<FinanzasDeportistaResponse>('/portal/finanzas');
    return res.data;
  },

  async obtenerMediciones(): Promise<MedicionesPortalResponse> {
    const res = await portalClient.get<MedicionesPortalResponse>('/portal/mediciones');
    return res.data;
  },

  async registrarMedicion(data: RegistrarMedicionPortalRequest): Promise<MedicionPortalItem> {
    const res = await portalClient.post<MedicionPortalItem>('/portal/mediciones', data);
    return res.data;
  },

  async obtenerAsistencias(): Promise<AsistenciasPortalResponse> {
    const res = await portalClient.get<AsistenciasPortalResponse>('/portal/asistencias');
    return res.data;
  },
};

