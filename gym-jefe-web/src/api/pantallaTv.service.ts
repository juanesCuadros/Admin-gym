import { apiClient } from './client';
import { PantallaConfig } from '../types/tenant.types';

export const pantallaTvService = {
  async getDisplayData(subdominio: string): Promise<any> {
    const response = await apiClient.get(`/pantalla-tv/display/${subdominio}`);
    return response.data;
  },

  async getConfig(): Promise<PantallaConfig> {
    const response = await apiClient.get<PantallaConfig>('/pantalla-tv/config');
    return response.data;
  },

  async updateConfig(config: Partial<PantallaConfig>): Promise<PantallaConfig> {
    const response = await apiClient.put<PantallaConfig>('/pantalla-tv/config', config);
    return response.data;
  },

  async testSaludo(deportistaNombre: string): Promise<any> {
    const response = await apiClient.post('/pantalla-tv/test-saludo', { nombre: deportistaNombre });
    return response.data;
  },
};
