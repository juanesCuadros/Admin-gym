/** Estaciones de GymDesk Escritorio (contrato E.1). */
export type EstadoEstacion = 'por_activar' | 'codigo_vencido' | 'activa' | 'revocada';

export interface Estacion {
  id: string;
  nombre: string;
  estado: EstadoEstacion;
  /** Instante ISO-8601. Solo mientras está `por_activar`. */
  codigo_expira_en?: string | null;
  activada_en?: string | null;
  nombre_equipo?: string | null;
  version_app?: string | null;
  ultima_sync_en?: string | null;
  revocada_en?: string | null;
  motivo_revocacion?: string | null;
  creada_por_nombre?: string | null;
  created_at: string;
}

/** El código viaja una sola vez: al crear la estación o al regenerarlo. */
export interface EstacionConCodigo extends Estacion {
  codigo: string;
}
