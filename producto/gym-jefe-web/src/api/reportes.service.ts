import { apiClient } from './client';
import { nombreDeContentDisposition } from '../utils/navegador';
import type {
  FiltrosIngresos,
  ParametrosExportar,
  ReporteAsistenciaResponse,
  ReporteDeportistasInactivosResponse,
  ReporteIngresosResponse,
  ReporteMembresiasPorVencerResponse,
} from '../types/reportes.types';

/** Módulo 10 · Reportes (`/reportes`). Permiso `reportes:leer`. */
export const reportesService = {
  async ingresos(filtros: FiltrosIngresos): Promise<ReporteIngresosResponse> {
    const res = await apiClient.get<ReporteIngresosResponse>('/reportes/ingresos', { params: filtros });
    return res.data;
  },

  async membresiasPorVencer(params: {
    dias?: number;
    pagina?: number;
    limite?: number;
  }): Promise<ReporteMembresiasPorVencerResponse> {
    const res = await apiClient.get<ReporteMembresiasPorVencerResponse>('/reportes/membresias-por-vencer', { params });
    return res.data;
  },

  async asistencia(params: { fecha_inicio?: string; fecha_fin?: string }): Promise<ReporteAsistenciaResponse> {
    const res = await apiClient.get<ReporteAsistenciaResponse>('/reportes/asistencia', { params });
    return res.data;
  },

  async deportistasInactivos(params: {
    dias_sin_asistencia?: number;
    pagina?: number;
    limite?: number;
  }): Promise<ReporteDeportistasInactivosResponse> {
    const res = await apiClient.get<ReporteDeportistasInactivosResponse>('/reportes/deportistas-inactivos', { params });
    return res.data;
  },

  /**
   * Exporta el reporte con los mismos filtros de la vista (CSV UTF-8 con BOM o Excel).
   * Devuelve el archivo y el nombre que sugiere el servidor (si CORS lo expone).
   */
  async exportar(params: ParametrosExportar): Promise<{ blob: Blob; nombre: string | null }> {
    const res = await apiClient.get('/reportes/exportar', { params, responseType: 'blob', timeout: 60000 });
    const cabecera = (res.headers as Record<string, string | undefined>)['content-disposition'];
    return { blob: res.data as Blob, nombre: nombreDeContentDisposition(cabecera) };
  },
};
