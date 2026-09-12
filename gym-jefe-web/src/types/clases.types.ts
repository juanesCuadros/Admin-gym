export interface ProgramarClaseRequest {
  nombre: string;
  tipo?: string;
  entrenador_id?: string;
  profesor_externo?: string;
  cupo: number;
  fecha_hora: string;
  duracion_minutos?: number;
  recurrente?: boolean;
  dias_semana?: number[]; // 0=Lunes, ..., 6=Domingo
  semanas_a_proyectar?: number;
  omitir_festivos?: boolean;
}

export interface ClaseResponse {
  id: string;
  gimnasio_id: string;
  nombre: string;
  tipo?: string | null;
  entrenador_id?: string | null;
  entrenador_nombre?: string | null;
  profesor_externo?: string | null;
  cupo: number;
  fecha_hora: string;
  recurrente: boolean;
  regla_recurrencia?: string | null;
  omitir_festivos: boolean;
  estado: 'programada' | 'cancelada' | 'realizada';
  reservas_totales: number;
  cupos_disponibles: number;
  asistencias_totales: number;
  created_at: string;
}

export interface ClasesPaginadasResponse {
  items: ClaseResponse[];
  total: number;
  skip: number;
  limit: number;
}

export interface CrearReservaRequest {
  deportista_id: string;
  venta_item_id?: string;
}

export interface ReservaResponse {
  id: string;
  gimnasio_id: string;
  clase_id: string;
  clase_nombre?: string | null;
  clase_fecha_hora?: string | null;
  deportista_id: string;
  deportista_nombre?: string | null;
  deportista_documento?: string | null;
  estado: 'reservada' | 'cancelada' | 'asistio' | 'no_show';
  pase_pagado: boolean;
  venta_item_id?: string | null;
  created_at: string;
}

export interface RegistrarAsistenciaRequest {
  deportista_id: string;
}

export interface ResumenAsistenciaClaseResponse {
  clase_id: string;
  clase_nombre: string;
  clase_fecha_hora: string;
  cupo_total: number;
  total_reservas: number;
  total_asistieron: number;
  total_ausentes: number;
  asistentes: any[];
  ausentes: ReservaResponse[];
}
