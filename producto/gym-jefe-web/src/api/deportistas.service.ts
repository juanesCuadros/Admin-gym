import { apiClient } from './client';
import {
  CrearDeportistaRequest,
  EditarDeportistaRequest,
  DeportistasPaginadosResponse,
  DeportistaResponse,
  FichaDeportistaResponse,
  RegistrarMedicionRequest,
  MedicionCorporalResponse,
  EnrolarHuellaRequest,
} from '../types/deportistas.types';
import type { DeportistaBusquedaItem } from '../types/comun.types';

export const deportistasService = {
  async getDeportistas(params?: {
    skip?: number;
    limit?: number;
    activo?: boolean;
    /** Búsqueda por prefijo de documento o coincidencia de nombre. */
    q?: string;
  }): Promise<DeportistasPaginadosResponse> {
    const response = await apiClient.get<DeportistasPaginadosResponse>('/deportistas', { params });
    return response.data;
  },

  async buscar(q: string): Promise<DeportistaBusquedaItem[]> {
    const response = await apiClient.get<DeportistaBusquedaItem[]>('/deportistas/buscar', { params: { q } });
    return response.data;
  },

  /** Ficha 360° (`GET /deportistas/{id}`): el backend no expone `/ficha`. */
  async getFicha(id: string): Promise<FichaDeportistaResponse> {
    const response = await apiClient.get<FichaDeportistaResponse>(`/deportistas/${id}`);
    return response.data;
  },

  async crear(data: CrearDeportistaRequest): Promise<DeportistaResponse> {
    const response = await apiClient.post<DeportistaResponse>('/deportistas', data);
    return response.data;
  },

  async actualizar(id: string, data: EditarDeportistaRequest): Promise<DeportistaResponse> {
    const response = await apiClient.put<DeportistaResponse>(`/deportistas/${id}`, data);
    return response.data;
  },

  async cambiarEstado(id: string, activo: boolean): Promise<any> {
    const response = await apiClient.patch(`/deportistas/${id}/estado`, { activo });
    return response.data;
  },

  async suprimirDatos(id: string, motivo: string): Promise<any> {
    const response = await apiClient.post(`/deportistas/${id}/suprimir-datos`, {
      motivo,
      confirmar: true,
    });
    return response.data;
  },

  async enrolarHuella(deportistaId: string, data: EnrolarHuellaRequest): Promise<any> {
    const response = await apiClient.post(`/deportistas/${deportistaId}/huellas`, data);
    return response.data;
  },

  async registrarMedicion(deportistaId: string, data: RegistrarMedicionRequest): Promise<MedicionCorporalResponse> {
    const response = await apiClient.post<MedicionCorporalResponse>(`/deportistas/${deportistaId}/mediciones`, data);
    return response.data;
  },

  async getMediciones(deportistaId: string): Promise<MedicionCorporalResponse[]> {
    const response = await apiClient.get<MedicionCorporalResponse[]>(`/deportistas/${deportistaId}/mediciones`);
    return response.data;
  },
};
