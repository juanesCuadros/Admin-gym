import { apiClient } from './client';
import type { Estacion, EstacionConCodigo } from '../types/estaciones.types';

/** Estaciones de GymDesk Escritorio. Solo el Jefe (contrato E.1). */
export const estacionesService = {
  async listar(): Promise<Estacion[]> {
    const res = await apiClient.get<Estacion[]>('/estaciones');
    return res.data;
  },

  async crear(nombre: string): Promise<EstacionConCodigo> {
    const res = await apiClient.post<EstacionConCodigo>('/estaciones', { nombre });
    return res.data;
  },

  async regenerarCodigo(id: string): Promise<EstacionConCodigo> {
    const res = await apiClient.post<EstacionConCodigo>(`/estaciones/${id}/codigo`);
    return res.data;
  },

  async revocar(id: string, motivo: string): Promise<Estacion> {
    const res = await apiClient.post<Estacion>(`/estaciones/${id}/revocar`, { motivo });
    return res.data;
  },
};
