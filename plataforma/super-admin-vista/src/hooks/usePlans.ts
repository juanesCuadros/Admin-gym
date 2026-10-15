import { useState, useEffect, useCallback } from 'react';
import { Plan } from '@/types/plan.types';
import { planService } from '@/services/planService';
import { parseApiError } from '@/services/api/errorHandler';

/** Catálogo de planes de suscripción (`GET /admin/plans`, SA-RF-33). */
export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /** Recarga el catálogo y devuelve la lista nueva (o `null` si falló). */
  const fetchPlans = useCallback(async (): Promise<Plan[] | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await planService.listPlans();
      setPlans(data);
      return data;
    } catch (err) {
      setError(parseApiError(err).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  /**
   * Reemplaza un plan en la lista con la respuesta del servidor. Las respuestas de crear, editar y
   * cambiar estado no traen `gimnasios_actuales` (llega en 0), así que se conserva el conteo que ya
   * venía del listado.
   */
  const reemplazar = useCallback((plan: Plan) => {
    setPlans((prev) => {
      const anterior = prev.find((p) => p.id === plan.id);
      if (!anterior) return [...prev, plan];
      const actualizado = { ...plan, gimnasios_actuales: anterior.gimnasios_actuales };
      return prev.map((p) => (p.id === plan.id ? actualizado : p));
    });
  }, []);

  return { plans, isLoading, error, refetch: fetchPlans, reemplazar };
}
