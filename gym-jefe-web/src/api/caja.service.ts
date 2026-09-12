import { apiClient } from './client';
import {
  AbrirTurnoRequest,
  CerrarTurnoRequest,
  CierreForzadoRequest,
  TurnoResumenDto,
  RegistrarVentaRequest,
  VentaResponseDto,
  RegistrarPagoMembresiaRequest,
  PagoMembresiaResponseDto,
  RegistrarEgresoRequest,
  EgresoResponseDto,
  HistorialMovimientosTurnoResponse,
} from '../types/caja.types';

export const cajaService = {
  async abrirTurno(data: AbrirTurnoRequest): Promise<TurnoResumenDto> {
    const response = await apiClient.post<TurnoResumenDto>('/caja/turnos/abrir', data);
    return response.data;
  },

  async getTurnoActual(): Promise<TurnoResumenDto | null> {
    const response = await apiClient.get<TurnoResumenDto | null>('/caja/turnos/actual');
    return response.data;
  },

  async cerrarTurno(data: CerrarTurnoRequest): Promise<TurnoResumenDto> {
    const response = await apiClient.post<TurnoResumenDto>('/caja/turnos/cerrar', data);
    return response.data;
  },

  async cierreForzado(turnoId: string, data: CierreForzadoRequest): Promise<TurnoResumenDto> {
    const response = await apiClient.post<TurnoResumenDto>(`/caja/turnos/${turnoId}/cierre-forzado`, data);
    return response.data;
  },

  async getMovimientos(turnoId: string): Promise<HistorialMovimientosTurnoResponse> {
    const response = await apiClient.get<HistorialMovimientosTurnoResponse>(`/caja/turnos/${turnoId}/movimientos`);
    return response.data;
  },

  async registrarVenta(data: RegistrarVentaRequest): Promise<VentaResponseDto> {
    const response = await apiClient.post<VentaResponseDto>('/caja/ventas', data);
    return response.data;
  },

  async anularVenta(ventaId: string, motivo: string, tipoMedioReembolso: 'efectivo' | 'otro'): Promise<any> {
    const response = await apiClient.post(`/caja/ventas/${ventaId}/anular`, {
      motivo,
      tipo_medio_reembolso: tipoMedioReembolso,
    });
    return response.data;
  },

  async registrarPagoMembresia(data: RegistrarPagoMembresiaRequest): Promise<PagoMembresiaResponseDto> {
    const response = await apiClient.post<PagoMembresiaResponseDto>('/caja/pagos-membresia', data);
    return response.data;
  },

  async anularPagoMembresia(pagoId: string, motivo: string): Promise<any> {
    const response = await apiClient.post(`/caja/pagos-membresia/${pagoId}/anular`, { motivo });
    return response.data;
  },

  async registrarEgreso(data: RegistrarEgresoRequest): Promise<EgresoResponseDto> {
    const response = await apiClient.post<EgresoResponseDto>('/caja/egresos', data);
    return response.data;
  },
};
