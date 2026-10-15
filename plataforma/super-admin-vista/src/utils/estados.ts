import { EstadoCalculado, FiltroEstadoCalculado, GymState } from '@/types/gym.types';

/** Etiquetas del estado guardado (§2.1). */
export const ETIQUETA_ESTADO: Record<GymState, string> = {
  prueba: 'En prueba',
  activo: 'Activo',
  suspendido: 'Suspendido',
  cancelado: 'Cancelado',
};

/** Etiquetas del estado calculado (§2.2). */
export const ETIQUETA_ESTADO_CALCULADO: Record<FiltroEstadoCalculado, string> = {
  al_dia: 'Al día',
  por_vencer: 'Por vencer',
  en_gracia: 'En gracia',
  bloqueado: 'Bloqueado',
  prueba_por_vencer: 'Prueba por vencer',
};

export function etiquetaEstadoCalculado(valor: EstadoCalculado | null | undefined): string {
  return valor ? ETIQUETA_ESTADO_CALCULADO[valor] ?? valor : '—';
}

/** Transiciones permitidas (§2.1); el servidor es quien las hace cumplir. */
export const TRANSICIONES: Record<GymState, GymState[]> = {
  prueba: ['activo', 'suspendido', 'cancelado'],
  activo: ['suspendido', 'cancelado'],
  suspendido: ['activo', 'cancelado'],
  cancelado: [],
};

/** Días que deben pasar desde la cancelación para poder eliminar (SA-RF-31). */
export const DIAS_RETENCION_CANCELADO = 30;
