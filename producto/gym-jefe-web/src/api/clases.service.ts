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
