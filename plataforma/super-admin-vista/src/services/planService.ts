import { apiClient } from './api/apiClient';
import { Plan, PlanCreate, PlanUpdate } from '@/types/plan.types';

/** Planes de suscripción (SA-RF-33, contrato 3.1). */
export const planService = {
  /** `GET /admin/plans`: catálogo completo (activos e inactivos). */
  async listPlans(): Promise<Plan[]> {
    const response = await apiClient.get<Plan[]>('/admin/plans');
    return response.data;
  },

  /** `POST /admin/plans`. `409 CODIGO_DUPLICADO`, `422 PLAN_INCOHERENTE`. */
  async createPlan(data: PlanCreate): Promise<Plan> {
    const response = await apiClient.post<Plan>('/admin/plans', data);
    return response.data;
  },

  /** `PUT /admin/plans/{id}` con `version`. `409 VERSION_DESACTUALIZADA` si otro lo cambió. */
  async updatePlan(planId: string, data: PlanUpdate): Promise<Plan> {
    const response = await apiClient.put<Plan>(`/admin/plans/${planId}`, data);
    return response.data;
  },

  /** `PATCH /admin/plans/{id}/status`. */
  async setPlanStatus(planId: string, activo: boolean): Promise<Plan> {
    const response = await apiClient.patch<Plan>(`/admin/plans/${planId}/status`, { activo });
    return response.data;
  },
};
