import { apiClient } from './client';
import {
  CheckinManualRequest,
  CheckinHuellaRequest,
  IngresoCortesiaRequest,
  CheckinResponseDto,
  ListadoIngresosHoyResponse,
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

  async getIngresosHoy(): Promise<ListadoIngresosHoyResponse> {
    const response = await apiClient.get<ListadoIngresosHoyResponse>('/control-ingreso/ingresos-hoy');
    return response.data;
  },

  async evaluarAcceso(deportistaId: string): Promise<any> {
    const response = await apiClient.get(`/control-ingreso/evaluar-acceso/${deportistaId}`);
    return response.data;
  },
};
