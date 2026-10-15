/**
 * Formatos de interfaz (PROMPT-TANDA-0-1, Parte A):
 * - Dinero en COP sin decimales: `$80.000`.
 * - Fechas dd/mm/aaaa en America/Bogota.
 *
 * Ojo: una fecha de negocio `YYYY-MM-DD` NO se pasa por `new Date()`: se interpretaría como medianoche
 * UTC y en Bogotá (UTC-5) se mostraría el día anterior. Se formatea partiendo el texto.
 */

export const ZONA_BOGOTA = 'America/Bogota';

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `80000` → `$80.000`; negativos → `-$80.000`. */
export function formatCOP(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  const entero = Math.round(Math.abs(valor));
  const conPuntos = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${valor < 0 ? '-' : ''}$${conPuntos}`;
}

/** Partes de una fecha-hora en Bogotá. */
function partesBogota(fecha: Date): Record<string, string> {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_BOGOTA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(fecha);
  const r: Record<string, string> = {};
  partes.forEach((p) => {
    r[p.type] = p.value;
  });
  return r;
}

/** Día calendario en Bogotá (`YYYY-MM-DD`) de un instante ISO (`2026-10-14T03:00:00Z`). */
export function fechaBogota(instante: string | Date): string {
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  if (Number.isNaN(d.getTime())) return '';
  const p = partesBogota(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hoy en Bogotá como `YYYY-MM-DD` (para inputs `type="date"` y comparaciones). */
export function hoyBogota(): string {
  return fechaBogota(new Date());
}

/**
 * `2026-10-14` → `14/10/2026`. También acepta un instante ISO con hora: se convierte al día de Bogotá.
 */
export function formatFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  const m = RE_FECHA.exec(valor);
  const ymd = m ? valor : fechaBogota(valor);
  const m2 = RE_FECHA.exec(ymd);
  if (!m2) return '—';
  return `${m2[3]}/${m2[2]}/${m2[1]}`;
}

/** Instante ISO → `14/10/2026 08:30` en hora de Bogotá. */
export function formatFechaHora(valor: string | null | undefined): string {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  const p = partesBogota(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function aDiaUTC(ymd: string): number {
  const m = RE_FECHA.exec(ymd);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Días calendario de `desde` a `hasta` (ambos `YYYY-MM-DD`). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aDiaUTC(hasta) - aDiaUTC(desde)) / 86_400_000);
}

/** `YYYY-MM-DD` + n días → `YYYY-MM-DD` (sin pasar por la zona local). */
export function sumarDias(ymd: string, dias: number): string {
  const t = aDiaUTC(ymd);
  if (Number.isNaN(t)) return '';
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Clave de idempotencia (10–100 caracteres) generada en el cliente. */
export function nuevaClaveIdempotencia(prefijo: string): string {
  const aleatorio =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random()
          .toString(36)
          .slice(2, 12)}`;
  return `${prefijo}-${aleatorio}`;
}

/** Texto de días restantes para un número que puede ser negativo (vencido). */
export function textoDiasRestantes(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return 'Sin fecha de corte';
  if (dias === 0) return 'Vence hoy';
  if (dias > 0) return dias === 1 ? 'Queda 1 día' : `Quedan ${dias} días`;
  const n = Math.abs(dias);
  return n === 1 ? 'Vencido hace 1 día' : `Vencido hace ${n} días`;
}
