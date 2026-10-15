import { apiClient } from './client';
import {
  CheckinManualRequest,
  CheckinHuellaRequest,
  IngresoCortesiaRequest,
  CheckinResponseDto,
  ListadoIngresosHoyResponse,
  SalidaRequest,
  SalidaResponseDto,
  DeportistasAdentroResponse,
} from '../types/controlIngreso.types';

export const controlIngresoService = {
  async checkinManual(data: CheckinManualRequest): Promise<CheckinResponseDto> {
    const response = await apiClient.post<CheckinResponseDto>('/control-ingreso/checkin-manual', data);
    return response.data;
  },

  async checkinHuella(data: CheckinHuellaRequest): Promise<CheckinResponseDto> {
    const response = await apiClient.post<CheckinResponseDto>('/control-ingreso/checkin-huella', data);
    return response.data;
  },

  async ingresoCortesia(data: IngresoCortesiaRequest): Promise<CheckinResponseDto> {
    const response = await apiClient.post<CheckinResponseDto>('/control-ingreso/cortesia', data);
    return response.data;
  },

  /** Resumen del día y listado paginado (más reciente primero). El backend admite `limit` hasta 100. */
  async getIngresosHoy(params?: { limit?: number; offset?: number }): Promise<ListadoIngresosHoyResponse> {
    const response = await apiClient.get<ListadoIngresosHoyResponse>('/control-ingreso/ingresos-hoy', { params });
    return response.data;
  },

  /** Contrato 2.2: personas con ingreso abierto hoy. */
  async getAdentro(): Promise<DeportistasAdentroResponse> {
    const response = await apiClient.get<DeportistasAdentroResponse>('/control-ingreso/adentro');
    return response.data;
  },

  /** Contrato 2.2: marca la salida. `409 SIN_INGRESO_ABIERTO` si no hay ingreso abierto. */
  async registrarSalida(data: SalidaRequest): Promise<SalidaResponseDto> {
    const response = await apiClient.post<SalidaResponseDto>('/control-ingreso/salida', data);
    return response.data;
  },

  async evaluarAcceso(deportistaId: string): Promise<any> {
    const response = await apiClient.get(`/control-ingreso/evaluar-acceso/${deportistaId}`);
    return response.data;
  },
};
