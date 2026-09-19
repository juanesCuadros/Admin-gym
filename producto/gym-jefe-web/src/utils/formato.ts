/**
 * Utilidades de formato compartidas (§A1).
 * Toda fecha se pinta en America/Bogota, sin importar el reloj del navegador.
 */

export const ZONA_HORARIA = 'America/Bogota';
export const FILAS_POR_PAGINA = 20;

const formatoCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** `80000` → `$ 80.000` normalizado a `$80.000`. */
export function formatCOP(valor: number | string | null | undefined): string {
  const n = typeof valor === 'string' ? Number(valor) : valor;
  if (n === null || n === undefined || Number.isNaN(n)) return '$0';
  return formatoCOP.format(Math.round(n)).replace(/\s/g, '');
}

function aDate(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

const formatoFecha = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formatoHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `dd/mm/aaaa` en America/Bogota. */
export function formatFecha(valor: string | Date | null | undefined): string {
  const d = aDate(valor);
  return d ? formatoFecha.format(d) : '—';
}

/** `HH:mm` (24 h) en America/Bogota. */
export function formatHora(valor: string | Date | null | undefined): string {
  const d = aDate(valor);
  return d ? formatoHora.format(d) : '—';
}

/** `dd/mm/aaaa HH:mm` en America/Bogota. */
export function formatFechaHora(valor: string | Date | null | undefined): string {
  const d = aDate(valor);
  return d ? `${formatoFecha.format(d)} ${formatoHora.format(d)}` : '—';
}

/** `dd/mm` en America/Bogota (para textos cortos como "Congelado hasta dd/mm"). */
export function formatDiaMes(valor: string | Date | null | undefined): string {
  return formatFecha(valor).slice(0, 5);
}

/**
 * Fecha relativa como complemento, nunca sola:
 * `Vence en 3 días (15/10/2026)` · `Venció hace 2 días (10/10/2026)` · `Vence hoy (12/10/2026)`.
 */
export function formatVencimiento(valor: string | Date | null | undefined, dias: number): string {
  const fecha = formatFecha(valor);
  if (dias === 0) return `Vence hoy (${fecha})`;
  if (dias > 0) return `Vence en ${dias} ${dias === 1 ? 'día' : 'días'} (${fecha})`;
  const n = Math.abs(dias);
  return `Venció hace ${n} ${n === 1 ? 'día' : 'días'} (${fecha})`;
}

/** `CC 1061234567`. Si no hay tipo, solo el número. */
export function formatDocumento(tipo: string | null | undefined, numero: string | null | undefined): string {
  if (!numero) return '—';
  return tipo ? `${tipo.toUpperCase()} ${numero}` : numero;
}
