import { ZONA_HORARIA } from './formato';

/**
 * Fechas de negocio (`YYYY-MM-DD`) en America/Bogota, sin importar el reloj del navegador.
 * Se usan para los valores por defecto de los filtros de fecha.
 */

const formatoISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Hoy en Bogotá, `YYYY-MM-DD`. */
export function hoyBogota(): string {
  return formatoISO.format(new Date());
}

/** Primer día del mes en curso en Bogotá. */
export function inicioMesBogota(): string {
  return `${hoyBogota().slice(0, 8)}01`;
}

/** Suma (o resta, con `n` negativo) días a una fecha `YYYY-MM-DD`, sin depender de la zona del navegador. */
export function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const utc = new Date(Date.UTC(a, m - 1, d + n));
  return utc.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `dd/mm/aaaa`, sin pasar por la zona horaria (son fechas de negocio, no instantes). */
export function formatFechaNegocio(fecha: string | null | undefined): string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return '—';
  const [a, m, d] = fecha.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
