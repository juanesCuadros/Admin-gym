import { useState, useEffect, useCallback, useRef } from 'react';
import { FiltroEstadoCalculado, GymListItem, GymState } from '@/types/gym.types';
import { gymService, ListGymsParams, OrdenGimnasios } from '@/services/gymService';
import { parseApiError } from '@/services/api/errorHandler';

/** Tamaño de página del listado (SA-RF-03 CA2). */
export const TAMANO_PAGINA = 20;

/**
 * Listado de gimnasios. La API devuelve un arreglo sin total, así que se pide un registro de
 * más para saber si hay página siguiente.
 */
export function useGyms(initialParams: ListGymsParams = {}) {
  const [gyms, setGyms] = useState<GymListItem[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearchState] = useState<string>(initialParams.search || '');
  const [estado, setEstadoState] = useState<GymState | ''>(initialParams.estado || '');
  const [estadoCalculado, setEstadoCalculadoState] = useState<FiltroEstadoCalculado | ''>(
    initialParams.estado_calculado || ''
  );
  const [orderBy, setOrderByState] = useState<OrdenGimnasios>(initialParams.order_by || 'urgency');
  const limit = initialParams.limit || TAMANO_PAGINA;
  const [offset, setOffset] = useState<number>(initialParams.offset || 0);
  // Solo se aplica la respuesta de la última petición: si el usuario cambia de filtro mientras
  // una petición anterior sigue en curso, esa respuesta vieja se descarta.
  const ultimaPeticion = useRef(0);

  const fetchGyms = useCallback(async () => {
    const peticion = ++ultimaPeticion.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await gymService.listGyms({
        search: search || undefined,
        estado: estado || undefined,
        estado_calculado: estadoCalculado || undefined,
        order_by: orderBy,
        limit: limit + 1,
        offset,
      });
      if (peticion !== ultimaPeticion.current) return;
      setHayMas(data.length > limit);
      setGyms(data.slice(0, limit));
    } catch (err) {
      if (peticion !== ultimaPeticion.current) return;
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      if (peticion === ultimaPeticion.current) setIsLoading(false);
    }
  }, [search, estado, estadoCalculado, orderBy, limit, offset]);

  useEffect(() => {
    fetchGyms();
  }, [fetchGyms]);

  // Cambiar un filtro vuelve a la primera página.
  const setSearch = (v: string) => {
    setSearchState(v);
    setOffset(0);
  };
  const setEstado = (v: GymState | '') => {
    setEstadoState(v);
    setOffset(0);
  };
  const setEstadoCalculado = (v: FiltroEstadoCalculado | '') => {
    setEstadoCalculadoState(v);
    setOffset(0);
  };
  const setOrderBy = (v: OrdenGimnasios) => {
    setOrderByState(v);
    setOffset(0);
  };

  return {
    gyms,
    hayMas,
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
    offset,
    setOffset,
    refetch: fetchGyms,
  };
}
