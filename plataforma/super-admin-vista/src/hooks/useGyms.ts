import { useState, useEffect, useCallback } from 'react';
import { FiltroEstadoCalculado, GymListItem, GymState } from '@/types/gym.types';
import { gymService, ListGymsParams, OrdenGimnasios } from '@/services/gymService';
import { parseApiError } from '@/services/api/errorHandler';

/** Tamaño de página del listado (SA-RF-03 CA2). */
export const TAMANO_PAGINA = 20;

export function useGyms(initialParams: ListGymsParams = {}) {
  const [gyms, setGyms] = useState<GymListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>(initialParams.search || '');
  const [estado, setEstado] = useState<GymState | ''>(initialParams.estado || '');
  const [estadoCalculado, setEstadoCalculado] = useState<FiltroEstadoCalculado | ''>(
    initialParams.estado_calculado || ''
  );
  const [orderBy, setOrderBy] = useState<OrdenGimnasios>(initialParams.order_by || 'urgency');
  const [limit, setLimit] = useState<number>(initialParams.limit || TAMANO_PAGINA);
  const [offset, setOffset] = useState<number>(initialParams.offset || 0);

  const fetchGyms = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await gymService.listGyms({
        search: search || undefined,
        estado: estado || undefined,
        estado_calculado: estadoCalculado || undefined,
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
  }, [search, estado, estadoCalculado, orderBy, limit, offset]);

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
    estadoCalculado,
    setEstadoCalculado,
    orderBy,
    setOrderBy,
    limit,
    setLimit,
    offset,
    setOffset,
    refetch: fetchGyms,
  };
}
