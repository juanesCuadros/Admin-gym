import { useState, useEffect, useCallback } from 'react';
import {
  Exercise,
  ExerciseCreate,
  ExerciseUpdate,
  ExerciseImportRequest,
  ExerciseImportResponse,
} from '@/types/exercise.types';
import { exerciseService, ListExercisesParams } from '@/services/exerciseService';
import { parseApiError } from '@/services/api/errorHandler';

export function useExercises(initialParams: ListExercisesParams = {}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>(initialParams.search || '');
  const [grupoMuscular, setGrupoMuscular] = useState<string>(initialParams.grupo_muscular || '');
  const [categoria, setCategoria] = useState<string>(initialParams.categoria || '');
  const [activo, setActivo] = useState<boolean | undefined>(initialParams.activo);
  const [limit, setLimit] = useState<number>(initialParams.limit || 50);
  const [offset, setOffset] = useState<number>(initialParams.offset || 0);

  const fetchExercises = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await exerciseService.listExercises({
        search: search || undefined,
        grupo_muscular: grupoMuscular || undefined,
        categoria: categoria || undefined,
        activo,
        limit,
        offset,
      });
      setExercises(data);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  }, [search, grupoMuscular, categoria, activo, limit, offset]);

  useEffect(() => {
    fetchExercises();
  }, [fetchExercises]);

  const createExercise = async (data: ExerciseCreate): Promise<Exercise> => {
    const created = await exerciseService.createExercise(data);
    await fetchExercises();
    return created;
  };

  const updateExercise = async (id: string, data: ExerciseUpdate): Promise<Exercise> => {
    const updated = await exerciseService.updateExercise(id, data);
    await fetchExercises();
    return updated;
  };

  const toggleStatus = async (id: string, newActivo: boolean): Promise<Exercise> => {
    const updated = await exerciseService.toggleStatus(id, newActivo);
    setExercises((prev) => prev.map((e) => (e.id === id ? updated : e)));
    return updated;
  };

  const importDataset = async (data: ExerciseImportRequest): Promise<ExerciseImportResponse> => {
    const result = await exerciseService.importDataset(data);
    await fetchExercises();
    return result;
  };

  return {
    exercises,
    isLoading,
    error,
    search,
    setSearch,
    grupoMuscular,
    setGrupoMuscular,
    categoria,
    setCategoria,
    activo,
    setActivo,
    limit,
    setLimit,
    offset,
    setOffset,
    refetch: fetchExercises,
    createExercise,
    updateExercise,
    toggleStatus,
    importDataset,
  };
}
