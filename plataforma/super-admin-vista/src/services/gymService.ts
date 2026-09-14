import { apiClient } from './api/apiClient';
import {
  GymListItem,
  GymDetail,
  GymCreateStepByStep,
  GymCreateResponse,
  GymUpdate,
  GymStateChangeRequest,
  GymCancelRequest,
  SubdomainCheckResponse,
  CredentialsIssuanceResponse,
  GymState,
} from '@/types/gym.types';

export interface ListGymsParams {
  search?: string;
  estado?: GymState | string;
  order_by?: 'urgency' | 'nombre' | 'fecha_corte' | 'created_at';
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

  async listGyms(params: ListGymsParams = {}): Promise<GymListItem[]> {
    const response = await apiClient.get<GymListItem[]>('/admin/gyms', {
      params: {
        search: params.search || undefined,
        estado: params.estado || undefined,
        order_by: params.order_by || 'urgency',
        limit: params.limit || 50,
        offset: params.offset || 0,
      },
    });
    return response.data;
  },

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

  async changeGymStatus(gymId: string, data: GymStateChangeRequest): Promise<GymDetail> {
    const response = await apiClient.patch<GymDetail>(`/admin/gyms/${gymId}/status`, data);
    return response.data;
  },

  async cancelGym(gymId: string, data: GymCancelRequest): Promise<GymDetail> {
    const response = await apiClient.post<GymDetail>(`/admin/gyms/${gymId}/cancel`, data);
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
