export interface TurnoTrabajo {
  id: string;
  staff_id: string;
  staff_nombre: string;
  staff_rol: string;
  entrada_en: string;
  salida_en?: string | null;
  /** `null` mientras siga abierto. */
  minutos?: number | null;
  cerrado_por_nombre?: string | null;
  motivo_cierre?: string | null;
}

export interface MiTurnoTrabajo {
  abierto?: TurnoTrabajo | null;
  minutos_hoy: number;
}

export interface ResumenTurnosPersona {
  staff_id: string;
  staff_nombre: string;
  minutos: number;
  turnos: number;
  abiertos: number;
}

export interface ListadoTurnosTrabajo {
  desde: string;
  hasta: string;
  items: TurnoTrabajo[];
  total: number;
  resumen: ResumenTurnosPersona[];
}
