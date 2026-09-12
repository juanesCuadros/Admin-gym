import { apiClient } from './client';
import {
  PlanResponse,
  PlanesListResponse,
  CrearPlanRequest,
  EditarPlanRequest,
  AsignarMembresiaRequest,
  CambiarPlanRequest,
  CancelarMembresiaRequest,
  CongelarMembresiaRequest,
  MembresiaResponse,
  MembresiasPaginadasResponse,
  FichaMembresiaResponse,
} from '../types/membresias.types';

export const membresiasService = {
  // Planes
  async getPlanes(params?: { solo_activos?: boolean }): Promise<PlanesListResponse> {
    const response = await apiClient.get<PlanesListResponse>('/membresias/planes', { params });
    return response.data;
  },

  async crearPlan(data: CrearPlanRequest): Promise<PlanResponse> {
    const response = await apiClient.post<PlanResponse>('/membresias/planes', data);
    return response.data;
  },

  async editarPlan(id: string, data: EditarPlanRequest): Promise<PlanResponse> {
    const response = await apiClient.put<PlanResponse>(`/membresias/planes/${id}`, data);
    return response.data;
  },

  async cambiarEstadoPlan(id: string, activo: boolean): Promise<any> {
    const response = await apiClient.patch(`/membresias/planes/${id}/estado`, { activo });
    return response.data;
  },

  // Membresías
  async getMembresias(params?: {
    skip?: number;
    limit?: number;
    estado?: string;
  }): Promise<MembresiasPaginadasResponse> {
    const response = await apiClient.get<MembresiasPaginadasResponse>('/membresias', { params });
    return response.data;
  },

  async getFichaMembresia(id: string): Promise<FichaMembresiaResponse> {
    const response = await apiClient.get<FichaMembresiaResponse>(`/membresias/${id}`);
    return response.data;
  },

  async asignarPlan(data: AsignarMembresiaRequest): Promise<MembresiaResponse> {
    const response = await apiClient.post<MembresiaResponse>('/membresias/asignar', data);
    return response.data;
  },

  async cambiarPlan(membresiaId: string, data: CambiarPlanRequest): Promise<MembresiaResponse> {
    const response = await apiClient.post<MembresiaResponse>(`/membresias/${membresiaId}/cambiar-plan`, data);
    return response.data;
  },

  async cancelarMembresia(membresiaId: string, data: CancelarMembresiaRequest): Promise<any> {
    const response = await apiClient.post(`/membresias/${membresiaId}/cancelar`, data);
    return response.data;
  },

  async congelarMembresia(membresiaId: string, data: CongelarMembresiaRequest): Promise<any> {
    const response = await apiClient.post(`/membresias/${membresiaId}/congelar`, data);
    return response.data;
  },

  async descongelarMembresia(membresiaId: string): Promise<any> {
    const response = await apiClient.post(`/membresias/${membresiaId}/descongelar`);
    return response.data;
  },
};
