import { apiClient } from './client';
import type { EstadoRevision, ListadoRevisiones, Revision } from '../types/revisiones.types';

/** Bandeja "Por revisar" de las estaciones de escritorio. Solo el Jefe (contrato E.5). */
export const revisionesService = {
  async listar(estado: EstadoRevision, limit: number, offset: number): Promise<ListadoRevisiones> {
    const res = await apiClient.get<ListadoRevisiones>('/sync/revisiones', { params: { estado, limit, offset } });
    return res.data;
  },

  /** Cierra una revisión sin dinero. La nota es obligatoria y solo se revisa una vez. */
  async darPorVisto(id: string, nota: string): Promise<Revision> {
    const res = await apiClient.post<Revision>(`/sync/revisiones/${id}/revisar`, { resolucion: 'visto', nota });
    return res.data;
  },
};
