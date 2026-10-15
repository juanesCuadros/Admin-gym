import { useState, useEffect, useCallback, useRef } from 'react';
import { EstadoSolicitudPlan, SolicitudPlan } from '@/types/planRequest.types';
import { planRequestService } from '@/services/planRequestService';
import { parseApiError } from '@/services/api/errorHandler';

/** Solicitudes de cambio de plan (`GET /admin/plan-requests`). `''` = todos los estados. */
export function usePlanRequests(estado: EstadoSolicitudPlan | '') {
  const [solicitudes, setSolicitudes] = useState<SolicitudPlan[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const ultimaPeticion = useRef(0);

  const fetchSolicitudes = useCallback(async () => {
    const peticion = ++ultimaPeticion.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await planRequestService.listRequests(estado || undefined);
      if (peticion === ultimaPeticion.current) setSolicitudes(data);
    } catch (err) {
      if (peticion === ultimaPeticion.current) setError(parseApiError(err).message);
    } finally {
      if (peticion === ultimaPeticion.current) setIsLoading(false);
    }
  }, [estado]);

  useEffect(() => {
    fetchSolicitudes();
  }, [fetchSolicitudes]);

  return { solicitudes, isLoading, error, refetch: fetchSolicitudes };
}
