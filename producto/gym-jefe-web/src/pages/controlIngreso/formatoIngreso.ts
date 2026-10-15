/**
 * Formatos propios del control de ingreso.
 */

/** `75` → `1 h 15 min` · `40` → `40 min`. */
export function formatPermanencia(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined || Number.isNaN(minutos)) return '—';
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${h} h` : `${h} h ${String(resto).padStart(2, '0')} min`;
}

/** Texto y color del resultado de un acceso (`abrio` · `alerta_mora` · `negado`). */
export function presentarResultado(resultado: string): { texto: string; variante: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (resultado) {
    case 'abrio':
      return { texto: 'Permitido', variante: 'success' };
    case 'alerta_mora':
      return { texto: 'Permitido con alerta de pago', variante: 'warning' };
    case 'negado':
      return { texto: 'Negado', variante: 'danger' };
    default:
      return { texto: resultado, variante: 'neutral' };
  }
}

/** Mensaje fijo del contrato 2.2 cuando no hay ingreso abierto. */
export const MENSAJE_SIN_INGRESO_ABIERTO = 'Esta persona no tiene un ingreso abierto hoy';
