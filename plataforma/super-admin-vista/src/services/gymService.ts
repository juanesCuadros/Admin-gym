import { apiClient } from './api/apiClient';
import {
  GymListItem,
  GymDetail,
  GymCreateStepByStep,
  GymCreateResponse,
  GymUpdate,
  GymStateChangeRequest,
  GymCancelRequest,
  GymDeleteRequest,
  GymDeleteResponse,
  SubdomainCheckResponse,
  CredentialsIssuanceResponse,
  GymState,
  FiltroEstadoCalculado,
} from '@/types/gym.types';
import { CambioPlanRequest, CambioPlanResponse } from '@/types/plan.types';

export type OrdenGimnasios = 'urgency' | 'nombre' | 'fecha_corte' | 'created_at';

export interface ListGymsParams {
  search?: string;
  estado?: GymState | '';
  estado_calculado?: FiltroEstadoCalculado | '';
  order_by?: OrdenGimnasios;
  limit?: number;
  offset?: number;
}

export const gymService = {
  async checkSubdomain(subdomain: string): Promise<SubdomainCheckResponse> {
    const response = await apiClient.get<SubdomainCheckResponse>('/admin/gyms/check-subdomain', {
      params: { subdomain },
    });
    return response.data;
  },

  /** `GET /admin/gyms` (SA-RF-02, 03; contrato 3.3). */
  async listGyms(params: ListGymsParams = {}): Promise<GymListItem[]> {
    const response = await apiClient.get<GymListItem[]>('/admin/gyms', {
      params: {
        search: params.search || undefined,
        estado: params.estado || undefined,
        estado_calculado: params.estado_calculado || undefined,
        order_by: params.order_by || 'urgency',
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      },
    });
    return response.data;
  },

  /** `POST /admin/gyms` (SA-RF-04). `suscripcion.plan_id` es obligatorio. */
  async createGym(data: GymCreateStepByStep): Promise<GymCreateResponse> {
    const response = await apiClient.post<GymCreateResponse>('/admin/gyms', data);
    return response.data;
  },

  async getGymDetail(gymId: string): Promise<GymDetail> {
    const response = await apiClient.get<GymDetail>(`/admin/gyms/${gymId}`);
    return response.data;
  },

  async updateGym(gymId: string, data: GymUpdate): Promise<GymDetail> {
    const response = await apiClient.put<GymDetail>(`/admin/gyms/${gymId}`, data);
    return response.data;
  },

  /** `PATCH /admin/gyms/{id}/status` (SA-RF-09). Al cancelar, la respuesta trae `export_url`. */
  async changeGymStatus(gymId: string, data: GymStateChangeRequest): Promise<GymDetail> {
    const response = await apiClient.patch<GymDetail>(`/admin/gyms/${gymId}/status`, data);
    return response.data;
  },

  /** `POST /admin/gyms/{id}/cancel` (SA-RF-10, 30). La respuesta trae `export_url` una sola vez. */
  async cancelGym(gymId: string, data: GymCancelRequest): Promise<GymDetail> {
    const response = await apiClient.post<GymDetail>(`/admin/gyms/${gymId}/cancel`, data);
    return response.data;
  },

  /** `DELETE /admin/gyms/{id}` (SA-RF-31). `409 AUN_NO_ELIMINABLE` antes de 30 días. */
  async deleteGym(gymId: string, data: GymDeleteRequest): Promise<GymDeleteResponse> {
    const response = await apiClient.delete<GymDeleteResponse>(`/admin/gyms/${gymId}`, { data });
    return response.data;
  },

  /** `PATCH /admin/gyms/{id}/plan` (contrato 3.1): cambio de plan manual por MVC. */
  async changePlan(gymId: string, data: CambioPlanRequest): Promise<CambioPlanResponse> {
    const response = await apiClient.patch<CambioPlanResponse>(`/admin/gyms/${gymId}/plan`, data);
    return response.data;
  },

  async regenerateCredentials(gymId: string): Promise<CredentialsIssuanceResponse> {
    const response = await apiClient.post<CredentialsIssuanceResponse>(
      `/admin/gyms/${gymId}/credentials/regenerate`
    );
    return response.data;
  },

  async resendCredentials(gymId: string): Promise<CredentialsIssuanceResponse> {
    const response = await apiClient.post<CredentialsIssuanceResponse>(
      `/admin/gyms/${gymId}/credentials/resend`
    );
    return response.data;
  },
};
