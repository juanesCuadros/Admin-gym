import { apiClient } from './client';
import type {
  BeneficiarioStaff,
  ConfigPagoEntrenador,
  Gasto,
  LiquidacionEntrenador,
  ListadoGastos,
  RegistrarGastoRequest,
  RegistrarPagoEntrenador,
  ReporteResultado,
} from '../types/gastos.types';

type Rango = { desde: string; hasta: string };

export const gastosService = {
  async listar(params: Rango & { categoria?: string; limit?: number; offset?: number }): Promise<ListadoGastos> {
    const res = await apiClient.get<ListadoGastos>('/gastos', { params });
    return res.data;
  },

  async registrar(data: RegistrarGastoRequest, clave: string): Promise<Gasto> {
    const res = await apiClient.post<Gasto>('/gastos', data, { headers: { 'X-Idempotency-Key': clave } });
    return res.data;
  },

  async beneficiarios(): Promise<BeneficiarioStaff[]> {
    const res = await apiClient.get<BeneficiarioStaff[]>('/gastos/beneficiarios');
    return res.data;
  },

  async resultado(params: Rango): Promise<ReporteResultado> {
    const res = await apiClient.get<ReporteResultado>('/gastos/resultado', { params });
    return res.data;
  },

  /** Solo el Jefe. */
  async liquidaciones(params: Rango): Promise<LiquidacionEntrenador[]> {
    const res = await apiClient.get<LiquidacionEntrenador[]>('/gastos/entrenadores', { params });
    return res.data;
  },

  async configurarPago(staffId: string, data: ConfigPagoEntrenador): Promise<LiquidacionEntrenador> {
    const res = await apiClient.put<LiquidacionEntrenador>(`/gastos/entrenadores/${staffId}/config`, data);
    return res.data;
  },

  async pagarEntrenador(staffId: string, data: RegistrarPagoEntrenador, clave: string): Promise<void> {
    await apiClient.post(`/gastos/entrenadores/${staffId}/pagos`, data, { headers: { 'X-Idempotency-Key': clave } });
  },
};
