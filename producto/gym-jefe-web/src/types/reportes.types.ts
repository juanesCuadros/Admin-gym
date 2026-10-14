import type { Monto } from './comun.types';

/** Módulo 10 · Reportes (`/reportes`). Formas de `app/modules/reportes/schemas.py`. */

export type TipoReporteExportar = 'ingresos' | 'membresias_por_vencer' | 'asistencia' | 'deportistas_inactivos';
export type FormatoExportar = 'csv' | 'excel';

export interface TransaccionReporte {
  id: string;
  fecha_hora: string;
  /** `venta_mostrador` | `pago_membresia` | `devolucion` */
  tipo: string;
  descripcion: string;
  monto: Monto;
  metodo: string;
  tipo_medio: string;
  anulado: boolean;
  motivo_anulacion?: string | null;
  registrado_por_nombre?: string | null;
}

export interface ReporteIngresosResponse {
  fecha_inicio: string;
  fecha_fin: string;
  total_ingresos_bruto: Monto;
  total_devoluciones: Monto;
  total_ingresos_neto: Monto;
  total_anulado: Monto;
  desglose_por_metodo: Record<string, Monto>;
  desglose_por_fuente: Record<string, Monto>;
  transacciones: TransaccionReporte[];
}

export interface FiltrosIngresos {
  fecha_inicio?: string;
  fecha_fin?: string;
  metodo?: string;
  /** `membresias` | `mostrador` */
  fuente?: string;
}

export interface MembresiaPorVencerItem {
  membresia_id: string;
  deportista_id: string;
  nombre: string;
  documento: string;
  correo?: string | null;
  telefono?: string | null;
  plan_id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  dias_restantes: number;
  congelamiento_activo: boolean;
}

export interface ReporteMembresiasPorVencerResponse {
  umbral_dias_aplicado: number;
  total: number;
  pagina: number;
  limite: number;
  total_paginas: number;
  items: MembresiaPorVencerItem[];
}

export interface AfluenciaHora {
  hora: number;
  cantidad: number;
}

export interface AfluenciaDiaSemana {
  dia_num: number;
  dia_nombre: string;
  cantidad: number;
}

export interface TopDeportistaAsistencia {
  deportista_id: string;
  nombre: string;
  documento: string;
  total_asistencias: number;
  ultima_asistencia?: string | null;
}

export interface ReporteAsistenciaResponse {
  fecha_inicio: string;
  fecha_fin: string;
  total_accesos: number;
  accesos_permitidos: number;
  accesos_denegados: number;
  cortesias: number;
  afluencia_por_hora: AfluenciaHora[];
  afluencia_por_dia_semana: AfluenciaDiaSemana[];
  top_deportistas: TopDeportistaAsistencia[];
}

/**
 * El backend también devuelve `estado_membresia` (nombre prohibido por §A4 y el contrato 2.1);
 * no se tipa ni se muestra.
 */
export interface DeportistaInactivoItem {
  deportista_id: string;
  nombre: string;
  documento: string;
  correo?: string | null;
  telefono?: string | null;
  plan_nombre: string;
  fecha_vencimiento: string;
  ultimo_checkin_utc?: string | null;
  dias_sin_asistir: number;
}

export interface ReporteDeportistasInactivosResponse {
  dias_sin_asistencia_umbral: number;
  total: number;
  pagina: number;
  limite: number;
  total_paginas: number;
  items: DeportistaInactivoItem[];
}

export interface ParametrosExportar {
  tipo_reporte: TipoReporteExportar;
  formato: FormatoExportar;
  fecha_inicio?: string;
  fecha_fin?: string;
  metodo?: string;
  fuente?: string;
  dias?: number;
  dias_sin_asistencia?: number;
}
