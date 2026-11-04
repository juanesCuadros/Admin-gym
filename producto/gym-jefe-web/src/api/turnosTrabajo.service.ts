import { apiClient } from './client';
import type { ListadoTurnosTrabajo, MiTurnoTrabajo, TurnoTrabajo } from '../types/turnosTrabajo.types';

export const turnosTrabajoService = {
  async mio(): Promise<MiTurnoTrabajo> {
    const res = await apiClient.get<MiTurnoTrabajo>('/turnos-trabajo/mio');
    return res.data;
  },

  async entrada(): Promise<TurnoTrabajo> {
    const res = await apiClient.post<TurnoTrabajo>('/turnos-trabajo/entrada');
    return res.data;
  },

  async salida(): Promise<TurnoTrabajo> {
    const res = await apiClient.post<TurnoTrabajo>('/turnos-trabajo/salida');
    return res.data;
  },

  async listar(params: { desde: string; hasta: string; staff_id?: string; limit?: number; offset?: number }): Promise<ListadoTurnosTrabajo> {
    const res = await apiClient.get<ListadoTurnosTrabajo>('/turnos-trabajo', { params });
    return res.data;
  },

  /** Solo el Jefe, para un turno que alguien olvidó cerrar. */
  async cerrarAjeno(id: string, data: { salida_en: string; motivo: string }): Promise<TurnoTrabajo> {
    const res = await apiClient.post<TurnoTrabajo>(`/turnos-trabajo/${id}/cerrar`, data);
    return res.data;
  },
};

/** "2 h 30 min": las horas se leen mejor así que en decimales. */
export function formatMinutos(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined) return '—';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
