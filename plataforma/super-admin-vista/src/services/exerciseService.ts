import { apiClient } from './api/apiClient';
import {
  Exercise,
  ExerciseCreate,
  ExerciseUpdate,
  ExerciseImportRequest,
  ExerciseImportResponse,
} from '@/types/exercise.types';

export interface ListExercisesParams {
  search?: string;
  grupo_muscular?: string;
  categoria?: string;
  activo?: boolean;
  limit?: number;
  offset?: number;
}

export const exerciseService = {
  async listExercises(params: ListExercisesParams = {}): Promise<Exercise[]> {
    const response = await apiClient.get<Exercise[]>('/admin/exercises', {
      params: {
        search: params.search || undefined,
        grupo_muscular: params.grupo_muscular || undefined,
        categoria: params.categoria || undefined,
        activo: params.activo !== undefined ? params.activo : undefined,
        limit: params.limit || 50,
        offset: params.offset || 0,
      },
    });
    return response.data;
  },

  async createExercise(data: ExerciseCreate): Promise<Exercise> {
    const response = await apiClient.post<Exercise>('/admin/exercises', data);
    return response.data;
  },

  async updateExercise(id: string, data: ExerciseUpdate): Promise<Exercise> {
    const response = await apiClient.put<Exercise>(`/admin/exercises/${id}`, data);
    return response.data;
  },

  async toggleStatus(id: string, activo: boolean): Promise<Exercise> {
    const response = await apiClient.patch<Exercise>(`/admin/exercises/${id}/status`, { activo });
    return response.data;
  },

  async importDataset(data: ExerciseImportRequest): Promise<ExerciseImportResponse> {
    const response = await apiClient.post<ExerciseImportResponse>('/admin/exercises/import', data);
    return response.data;
  },
};
