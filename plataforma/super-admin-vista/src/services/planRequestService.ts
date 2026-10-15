import { apiClient } from './api/apiClient';
import {
  AprobacionResponse,
  AprobarSolicitudRequest,
  EstadoSolicitudPlan,
  SolicitudPlan,
} from '@/types/planRequest.types';

/** Solicitudes de cambio de plan hechas por los gimnasios (contrato 3.1). */
export const planRequestService = {
  async listRequests(estado?: EstadoSolicitudPlan): Promise<SolicitudPlan[]> {
    const response = await apiClient.get<SolicitudPlan[]>('/admin/plan-requests', {
      params: { estado: estado || undefined },
    });
    return response.data;
  },

  /**
   * Aprueba registrando el pago. La `Idempotency-Key` la genera quien llama y se conserva en los
   * reintentos: el mismo valor devuelve el mismo resultado sin duplicar el pago.
   */
  async approve(
    solicitudId: string,
    data: AprobarSolicitudRequest,
    idempotencyKey: string
  ): Promise<AprobacionResponse> {
    const response = await apiClient.post<AprobacionResponse>(
      `/admin/plan-requests/${solicitudId}/approve`,
      data,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },

  async reject(solicitudId: string, motivo: string): Promise<SolicitudPlan> {
    const response = await apiClient.post<SolicitudPlan>(`/admin/plan-requests/${solicitudId}/reject`, {
      motivo,
    });
    return response.data;
  },
};
