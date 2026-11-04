import type { CatalogoClase } from '../types/clases.types';
import { apiClient } from './client';
import {
  ClasesPaginadasResponse,
  ClaseResponse,
  ProgramarClaseRequest,
  CrearReservaRequest,
  ReservaResponse,
  RegistrarAsistenciaRequest,
  ResumenAsistenciaClaseResponse,
} from '../types/clases.types';

export const clasesService = {
  async getCatalogo(): Promise<CatalogoClase[]> {
    const response = await apiClient.get<CatalogoClase[]>('/clases/catalogo');
    return response.data;
  },

  async crearEnCatalogo(data: Omit<CatalogoClase, 'id' | 'activo'>): Promise<CatalogoClase> {
    const response = await apiClient.post<CatalogoClase>('/clases/catalogo', data);
    return response.data;
  },

  async actualizarEnCatalogo(id: string, data: Omit<CatalogoClase, 'id'>): Promise<CatalogoClase> {
    const response = await apiClient.put<CatalogoClase>(`/clases/catalogo/${id}`, data);
    return response.data;
  },

  async getClases(params?: {
    skip?: number;
    limit?: number;
    desde?: string;
    hasta?: string;
    entrenador_id?: string;
  }): Promise<ClasesPaginadasResponse> {
    const response = await apiClient.get<ClasesPaginadasResponse>('/clases', { params });
    return response.data;
  },

  async getClase(id: string): Promise<ClaseResponse> {
    const response = await apiClient.get<ClaseResponse>(`/clases/${id}`);
    return response.data;
  },

  async programarClase(data: ProgramarClaseRequest): Promise<ClaseResponse[]> {
    const response = await apiClient.post<ClaseResponse[]>('/clases', data);
    return response.data;
  },

  async cancelarClase(id: string): Promise<any> {
    const response = await apiClient.patch(`/clases/${id}/cancelar`);
    return response.data;
  },

  async getReservas(claseId: string): Promise<ReservaResponse[]> {
    const response = await apiClient.get<ReservaResponse[]>(`/clases/${claseId}/reservas`);
    return response.data;
  },

  /** Con `cobro`, `idempotencyKey` es obligatoria: el reintento con la misma clave no cobra dos veces. */
  async crearReserva(claseId: string, data: CrearReservaRequest, idempotencyKey?: string): Promise<ReservaResponse> {
    const response = await apiClient.post<ReservaResponse>(`/clases/${claseId}/reservas`, data, {
      headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : undefined,
    });
    return response.data;
  },

  async cancelarReserva(claseId: string, reservaId: string): Promise<any> {
    const response = await apiClient.delete(`/clases/${claseId}/reservas/${reservaId}`);
    return response.data;
  },

  async getAsistencia(claseId: string): Promise<ResumenAsistenciaClaseResponse> {
    const response = await apiClient.get<ResumenAsistenciaClaseResponse>(`/clases/${claseId}/asistencia`);
    return response.data;
  },

  async registrarAsistencia(claseId: string, data: RegistrarAsistenciaRequest): Promise<any> {
    const response = await apiClient.post(`/clases/${claseId}/asistencia`, data);
    return response.data;
  },
};
