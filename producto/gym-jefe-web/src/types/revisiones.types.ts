/** Lo que una estación de GymDesk Escritorio registró y quedó por revisar (contrato E.5). */
export type EstadoRevision = 'pendiente_revision' | 'revisado';

export type ResolucionRevision = 'visto' | 'aplicar' | 'ajustar' | 'anular';

export interface Revision {
  id: string;
  /** Sobre qué es: `checkins` (un ingreso), `staff`, `estaciones`. */
  entidad: string;
  entidad_id?: string | null;
  /** Tipo de operación de la estación: `ingreso`, `cortesia`, `auditoria_estacion`. */
  tipo_operacion: string;
  motivo_codigo: string;
  motivo: string;
  detalle: Record<string, unknown>;
  estacion_nombre: string;
  registrado_por_nombre?: string | null;
  /** Instante ISO-8601 en que ocurrió en la estación. */
  ocurrida_en: string;
  recibida_en: string;
  estado_revision: EstadoRevision;
  /** Qué puede hacer el Jefe mientras está pendiente. Hoy solo `visto`. */
  resoluciones_posibles: ResolucionRevision[];
  resolucion?: ResolucionRevision | null;
  revisado_por_nombre?: string | null;
  revisado_en?: string | null;
  nota_revision?: string | null;
}

export interface ListadoRevisiones {
  total: number;
  pendientes: number;
  items: Revision[];
}
