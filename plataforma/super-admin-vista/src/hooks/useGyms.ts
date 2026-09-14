import { useState, useEffect, useCallback } from 'react';
import { GymListItem, GymState } from '@/types/gym.types';
import { gymService, ListGymsParams } from '@/services/gymService';
import { parseApiError } from '@/services/api/errorHandler';

export function useGyms(initialParams: ListGymsParams = {}) {
  const [gyms, setGyms] = useState<GymListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>(initialParams.search || '');
  const [estado, setEstado] = useState<GymState | string>(initialParams.estado || '');
  const [orderBy, setOrderBy] = useState<'urgency' | 'nombre' | 'fecha_corte' | 'created_at'>(
    initialParams.order_by || 'urgency'
  );
  const [limit, setLimit] = useState<number>(initialParams.limit || 50);
  const [offset, setOffset] = useState<number>(initialParams.offset || 0);

  const fetchGyms = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await gymService.listGyms({
        search: search || undefined,
        estado: estado || undefined,
        order_by: orderBy,
        limit,
        offset,
      });
      setGyms(data);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  }, [search, estado, orderBy, limit, offset]);

  useEffect(() => {
    fetchGyms();
  }, [fetchGyms]);

  return {
    gyms,
    isLoading,
    error,
    search,
    setSearch,
    estado,
    setEstado,
    orderBy,
    setOrderBy,
    limit,
    setLimit,
    offset,
    setOffset,
    refetch: fetchGyms,
  };
}
