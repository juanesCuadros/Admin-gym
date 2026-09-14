import { apiClient } from './client';
import {
  EjerciciosPaginadosResponse,
  EjercicioResponse,
  CrearEjercicioPropioRequest,
  PlantillasPaginadasResponse,
  RutinaPlantillaResponse,
  CrearPlantillaRequest,
  AsignarRutinaRequest,
  PersonalizarRutinaAsignadaRequest,
  RutinaAsignadaResponse,
} from '../types/entrenamiento.types';

export const entrenamientoService = {
  // Ejercicios
  async getEjercicios(params?: {
    skip?: number;
    limit?: number;
    grupo_muscular?: string;
    propio?: boolean;
    solo_activos?: boolean;
  }): Promise<EjerciciosPaginadosResponse> {
    const response = await apiClient.get<EjerciciosPaginadosResponse>('/entrenamiento/ejercicios', { params });
    return response.data;
  },

  async crearEjercicio(data: CrearEjercicioPropioRequest): Promise<EjercicioResponse> {
    const response = await apiClient.post<EjercicioResponse>('/entrenamiento/ejercicios', data);
    return response.data;
  },

  async cambiarEstadoEjercicio(id: string, activo: boolean): Promise<any> {
    const response = await apiClient.patch(`/entrenamiento/ejercicios/${id}/estado`, { activo });
    return response.data;
  },

  // Plantillas
  async getPlantillas(params?: { skip?: number; limit?: number }): Promise<PlantillasPaginadasResponse> {
    const response = await apiClient.get<PlantillasPaginadasResponse>('/entrenamiento/plantillas', { params });
    return response.data;
  },

  async getPlantilla(id: string): Promise<RutinaPlantillaResponse> {
    const response = await apiClient.get<RutinaPlantillaResponse>(`/entrenamiento/plantillas/${id}`);
    return response.data;
  },

  async crearPlantilla(data: CrearPlantillaRequest): Promise<RutinaPlantillaResponse> {
    const response = await apiClient.post<RutinaPlantillaResponse>('/entrenamiento/plantillas', data);
    return response.data;
  },

  // Rutinas Asignadas
  async asignarRutina(data: AsignarRutinaRequest): Promise<RutinaAsignadaResponse> {
    const response = await apiClient.post<RutinaAsignadaResponse>('/entrenamiento/rutinas-asignadas', data);
    return response.data;
  },

  async getRutinasDeportista(deportistaId: string): Promise<RutinaAsignadaResponse[]> {
    const response = await apiClient.get<RutinaAsignadaResponse[]>(
      `/entrenamiento/rutinas-asignadas/deportista/${deportistaId}`
    );
    return response.data;
  },

  async personalizarRutina(
    rutinaAsignadaId: string,
    data: PersonalizarRutinaAsignadaRequest
  ): Promise<RutinaAsignadaResponse> {
    const response = await apiClient.post<RutinaAsignadaResponse>(
      `/entrenamiento/rutinas-asignadas/${rutinaAsignadaId}/personalizar`,
      data
    );
    return response.data;
  },
};
