/**
 * Estado del deportista (§A4): un solo enum en todo el sistema.
 * Se calcula en el backend, nunca se guarda. Prohibidos `al_dia`, `en_mora` e `inactivo`.
 */

export const ESTADOS_DEPORTISTA = [
  'desactivado',
  'cancelado',
  'sin_membresia',
  'congelado',
  'vencido',
  'en_gracia',
  'por_vencer',
  'activo',
] as const;

export type EstadoDeportista = (typeof ESTADOS_DEPORTISTA)[number];

export type VarianteEstado = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface DetalleEstado {
  /** Días restantes (por_vencer) o días desde el vencimiento (en_gracia). */
  dias?: number;
  /** Fecha fin del congelamiento (congelado). */
  hasta?: string | Date | null;
}

const NOMBRES: Record<EstadoDeportista, string> = {
  desactivado: 'Desactivado',
  cancelado: 'Cancelado',
  sin_membresia: 'Sin membresía',
  congelado: 'Congelado',
  vencido: 'Vencido',
  en_gracia: 'En gracia',
  por_vencer: 'Por vencer',
  activo: 'Activo',
};

export function esEstadoDeportista(valor: unknown): valor is EstadoDeportista {
  return typeof valor === 'string' && (ESTADOS_DEPORTISTA as readonly string[]).includes(valor);
}

export function nombreEstado(estado: EstadoDeportista): string {
  return NOMBRES[estado];
}

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

/** Color y texto según la tabla de §A4. */
export function presentarEstado(
  estado: EstadoDeportista,
  detalle: DetalleEstado = {},
  formatDiaMes: (v: string | Date | null | undefined) => string = () => '',
): { variante: VarianteEstado; texto: string } {
  switch (estado) {
    case 'activo':
      return { variante: 'success', texto: 'Activo' };
    case 'por_vencer':
      return {
        variante: 'warning',
        texto: detalle.dias === undefined ? 'Por vencer' : `Vence en ${plural(detalle.dias, 'día', 'días')}`,
      };
    case 'en_gracia':
      return {
        variante: 'warning',
        texto:
          detalle.dias === undefined ? 'En gracia' : `Vencido hace ${plural(Math.abs(detalle.dias), 'día', 'días')}`,
      };
    case 'vencido':
      return { variante: 'danger', texto: 'Vencido' };
    case 'congelado':
      return {
        variante: 'info',
        texto: detalle.hasta ? `Congelado hasta ${formatDiaMes(detalle.hasta)}` : 'Congelado',
      };
    case 'cancelado':
    case 'sin_membresia':
    case 'desactivado':
      return { variante: 'neutral', texto: NOMBRES[estado] };
  }
}
