import { apiClient } from './client';
import type {
  ActualizarStaffRequest,
  CambiarEstadoStaffRequest,
  CambiarEstadoStaffResponse,
  CrearStaffRequest,
  CrearStaffResponse,
  CredencialTemporal,
  FiltrosStaff,
  StaffListResponse,
  StaffResponse,
  TransferirJefeRequest,
  TransferirJefeResponse,
} from '../types/personal.types';

/** Módulo 09 · Personal (`/personal`). */
export const personalService = {
  async listar(filtros: FiltrosStaff): Promise<StaffListResponse> {
    const res = await apiClient.get<StaffListResponse>('/personal', { params: filtros });
    return res.data;
  },

  async obtener(id: string): Promise<StaffResponse> {
    const res = await apiClient.get<StaffResponse>(`/personal/${id}`);
    return res.data;
  },

  /** Contrato 2.7: devuelve `password_temporal` y `expira_en` una sola vez. */
  async crear(data: CrearStaffRequest): Promise<CrearStaffResponse> {
    const res = await apiClient.post<CrearStaffResponse>('/personal', data);
    return res.data;
  },

  async actualizar(id: string, data: ActualizarStaffRequest): Promise<StaffResponse> {
    const res = await apiClient.put<StaffResponse>(`/personal/${id}`, data);
    return res.data;
  },

  async cambiarEstado(id: string, data: CambiarEstadoStaffRequest): Promise<CambiarEstadoStaffResponse> {
    const res = await apiClient.patch<CambiarEstadoStaffResponse>(`/personal/${id}/estado`, data);
    return res.data;
  },

  async eliminar(id: string): Promise<void> {
    await apiClient.delete(`/personal/${id}`);
  },

  /** Contrato 2.7 (nuevo): nueva credencial temporal; cierra las sesiones de esa persona. */
  async regenerarCredencial(id: string): Promise<CredencialTemporal> {
    const res = await apiClient.post<CredencialTemporal>(`/personal/${id}/regenerar-credencial`);
    return res.data;
  },

  async transferirJefe(data: TransferirJefeRequest): Promise<TransferirJefeResponse> {
    const res = await apiClient.post<TransferirJefeResponse>('/personal/transferir-jefe', data);
    return res.data;
  },
};
