import { apiClient } from './api/apiClient';
import { DashboardMetrics } from '@/types/dashboard.types';

export const dashboardService = {
  async getMetrics(): Promise<DashboardMetrics> {
    const response = await apiClient.get<DashboardMetrics>('/admin/dashboard/metrics');
    return response.data;
  },
};
