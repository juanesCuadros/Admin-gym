import { apiClient } from './client';

export const myGymService = {
  async getStatus(): Promise<{ modulo: string; estado: string }> {
    const response = await apiClient.get('/my-gym/status');
    return response.data;
  },
};
