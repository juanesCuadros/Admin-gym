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
  CrearPaqueteRequest,
  CrearPaqueteResponse,
  DetallePaqueteResponse,
} from '../types/membresias.types';

export const membresiasService = {
  // Planes
  async getPlanes(params?: { solo_activos?: boolean }): Promise<PlanesListResponse> {
    const response = await apiClient.get<PlanesListResponse>('/planes', { params });
    return response.data;
  },

  async crearPlan(data: CrearPlanRequest): Promise<PlanResponse> {
    const response = await apiClient.post<PlanResponse>('/planes', data);
    return response.data;
  },

  async editarPlan(id: string, data: EditarPlanRequest): Promise<PlanResponse> {
    const response = await apiClient.put<PlanResponse>(`/planes/${id}`, data);
    return response.data;
  },

  async cambiarEstadoPlan(id: string, activo: boolean): Promise<any> {
    const response = await apiClient.patch(`/planes/${id}/estado`, { activo });
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

  /** Vende el plan: crea la membresía y su cobro en un solo paso. */
  async asignarPlan(data: AsignarMembresiaRequest, idempotencyKey: string): Promise<MembresiaResponse> {
    const response = await apiClient.post<MembresiaResponse>('/membresias/asignar', data, {
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
    return response.data;
  },

  /** El plan nuevo empieza cuando termina el actual y se cobra en el mismo paso. */
  async cambiarPlan(membresiaId: string, data: CambiarPlanRequest, idempotencyKey: string): Promise<MembresiaResponse> {
    const response = await apiClient.post<MembresiaResponse>(`/membresias/${membresiaId}/cambiar-plan`, data, {
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
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

  // Planes grupales (contrato 1.3)
  /** Vende el plan grupal: paquete, membresías y un solo cobro en un paso. */
  async crearPaquete(data: CrearPaqueteRequest, idempotencyKey: string): Promise<CrearPaqueteResponse> {
    const response = await apiClient.post<CrearPaqueteResponse>('/membresias/paquetes', data, {
      headers: { 'X-Idempotency-Key': idempotencyKey },
    });
    return response.data;
  },

  async getPaquete(id: string): Promise<DetallePaqueteResponse> {
    const response = await apiClient.get<DetallePaqueteResponse>(`/membresias/paquetes/${id}`);
    return response.data;
  },
};
