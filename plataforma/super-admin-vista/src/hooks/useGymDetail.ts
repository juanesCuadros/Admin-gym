import { useState, useEffect, useCallback } from 'react';
import {
  GymDetail,
  GymUpdate,
  GymStateChangeRequest,
  GymCancelRequest,
  CredentialsIssuanceResponse,
} from '@/types/gym.types';
import { gymService } from '@/services/gymService';
import { parseApiError } from '@/services/api/errorHandler';

export function useGymDetail(gymId?: string) {
  const [gym, setGym] = useState<GymDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!gymId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await gymService.getGymDetail(gymId);
      setGym(data);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  }, [gymId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const updateGym = async (data: GymUpdate) => {
    if (!gymId) throw new Error('Gym ID is required');
    const updated = await gymService.updateGym(gymId, data);
    setGym(updated);
    return updated;
  };

  const changeStatus = async (data: GymStateChangeRequest) => {
    if (!gymId) throw new Error('Gym ID is required');
    const updated = await gymService.changeGymStatus(gymId, data);
    setGym(updated);
    return updated;
  };

  const cancelGym = async (data: GymCancelRequest) => {
    if (!gymId) throw new Error('Gym ID is required');
    const updated = await gymService.cancelGym(gymId, data);
    setGym(updated);
    return updated;
  };

  const regenerateCredentials = async (): Promise<CredentialsIssuanceResponse> => {
    if (!gymId) throw new Error('Gym ID is required');
    return await gymService.regenerateCredentials(gymId);
  };

  const resendCredentials = async (): Promise<CredentialsIssuanceResponse> => {
    if (!gymId) throw new Error('Gym ID is required');
    return await gymService.resendCredentials(gymId);
  };

  return {
    gym,
    isLoading,
    error,
    refetch: fetchDetail,
    updateGym,
    changeStatus,
    cancelGym,
    regenerateCredentials,
    resendCredentials,
  };
}
