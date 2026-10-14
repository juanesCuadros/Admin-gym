import { apiClient } from './client';
import type {
  ActualizarBrandingRequest,
  ActualizarInfoGymRequest,
  ActualizarMetodosPagoRequest,
  ActualizarParametrosRequest,
  AuditoriaFiltrosDisponiblesResponse,
  AuditoriaPaginadaResponse,
  FiltrosAuditoria,
  InfoGymResponse,
  LandingInfoResponse,
  MiPlanResponse,
  ParametrosTenantResponse,
  PlanSaasDisponible,
  SolicitarPlanRequest,
} from '../types/myGym.types';

/** Módulo 11 · MyGymOS (`/my-gym`). */
export const myGymService = {
  async getStatus(): Promise<{ modulo: string; estado: string }> {
    const response = await apiClient.get('/my-gym/status');
    return response.data;
  },

  /** Información general, métodos de pago y parámetros. Permiso `configuracion:leer`. */
  async getInfo(): Promise<InfoGymResponse> {
    const res = await apiClient.get<InfoGymResponse>('/my-gym/info');
    return res.data;
  },

  async actualizarInfo(data: ActualizarInfoGymRequest): Promise<InfoGymResponse> {
    const res = await apiClient.put<InfoGymResponse>('/my-gym/info', data);
    return res.data;
  },

  async actualizarBranding(data: ActualizarBrandingRequest): Promise<InfoGymResponse> {
    const res = await apiClient.patch<InfoGymResponse>('/my-gym/branding', data);
    return res.data;
  },

  async actualizarMetodosPago(data: ActualizarMetodosPagoRequest): Promise<InfoGymResponse> {
    const res = await apiClient.put<InfoGymResponse>('/my-gym/metodos-pago', data);
    return res.data;
  },

  async actualizarParametros(data: ActualizarParametrosRequest): Promise<ParametrosTenantResponse> {
    const res = await apiClient.patch<ParametrosTenantResponse>('/my-gym/parametros', data);
    return res.data;
  },

  async getLanding(): Promise<LandingInfoResponse> {
    const res = await apiClient.get<LandingInfoResponse>('/my-gym/landing');
    return res.data;
  },

  /** PNG del QR para imprimir. */
  async descargarQrPng(): Promise<Blob> {
    const res = await apiClient.get('/my-gym/landing/qr.png', { responseType: 'blob' });
    return res.data as Blob;
  },

  // --- Auditoría (solo Jefe) ---

  async getAuditoria(filtros: FiltrosAuditoria): Promise<AuditoriaPaginadaResponse> {
    const res = await apiClient.get<AuditoriaPaginadaResponse>('/my-gym/auditoria', { params: filtros });
    return res.data;
  },

  async getFiltrosAuditoria(): Promise<AuditoriaFiltrosDisponiblesResponse> {
    const res = await apiClient.get<AuditoriaFiltrosDisponiblesResponse>('/my-gym/auditoria/filtros');
    return res.data;
  },

  // --- Mi suscripción (contrato 2.6; el backend aún no lo expone) ---

  async getMiPlan(): Promise<MiPlanResponse> {
    const res = await apiClient.get<MiPlanResponse>('/my-gym/plan');
    return res.data;
  },

  async getPlanesDisponibles(): Promise<PlanSaasDisponible[]> {
    const res = await apiClient.get<PlanSaasDisponible[]>('/my-gym/planes');
    return res.data;
  },

  async solicitarPlan(data: SolicitarPlanRequest): Promise<{ id: string }> {
    const res = await apiClient.post<{ id: string }>('/my-gym/plan/solicitud', data);
    return res.data;
  },

  async cancelarSolicitudPlan(): Promise<void> {
    await apiClient.delete('/my-gym/plan/solicitud');
  },
};
