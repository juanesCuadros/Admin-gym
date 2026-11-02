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

/** Extrae solo los dígitos de un valor monetario y normaliza ceros a la izquierda (`"00500"` → `"500"`, `"0"` → `"0"`). */
export function limpiarMiles(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  const digitos = String(valor).replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.replace(/^0+(?=\d)/, '');
}

/** Aplica el punto separador de miles en tiempo real (`"90000"` → `"90.000"`, `1250000` → `"1.250.000"`). */
export function formatMiles(valor: string | number | null | undefined): string {
  const limpio = limpiarMiles(valor);
  if (!limpio) return '';
  return limpio.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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

const formatoDiaSemana = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** `mié, 21 oct` en America/Bogota (para agendas y listas de clases). */
export function formatDiaSemana(valor: string | Date | null | undefined): string {
  const d = aDate(valor);
  if (!d) return '—';
  const t = formatoDiaSemana.format(d).replace(/\./g, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
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

/**
 * Valida que una dirección física de sede tenga una longitud mínima (al menos 5 caracteres)
 * y un formato coherente con nomenclatura vial y numeración (ej. 'Carrera 15 # 85-30').
 */
const PATRON_NOMENCLATURA_DIRECCION =
  /\b(calle|cll|cl|carrera|cra|cr|kr|avenida|ave|av|diagonal|dg|transversal|tv|autopista|circular|circunvalar|manzana|mz|lote|km|kilometro|vereda|sede|edificio|torre|piso|local|centro comercial|cc|barrio|sector)\b/i;
const PATRON_CARACTERES_DIRECCION = /^[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s\#\-\.\,\/\°\º]+$/;

export function validarDireccionSede(direccion?: string | null): string | null {
  if (!direccion || direccion.trim() === '') {
    return null;
  }
  const val = direccion.trim();
  if (val.length < 5) {
    return 'La dirección de la sede debe tener al menos 5 caracteres (ej. Carrera 15 # 85-30).';
  }
  if (val.length > 250) {
    return 'La dirección de la sede no puede exceder los 250 caracteres.';
  }
  if (!PATRON_CARACTERES_DIRECCION.test(val)) {
    return 'La dirección de la sede contiene caracteres no permitidos.';
  }
  if (/^\d+$/.test(val)) {
    return 'La dirección de la sede no puede contener únicamente números.';
  }
  const sinEspacios = val.replace(/\s+/g, '');
  if (new Set(sinEspacios).size <= 1) {
    return 'La dirección de la sede debe ser una dirección válida y legible.';
  }
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(val)) {
    return 'La dirección de la sede debe contener letras o nomenclatura vial.';
  }
  const tieneNumero = /\d/.test(val);
  const tieneNomenclatura = PATRON_NOMENCLATURA_DIRECCION.test(val);
  if (!tieneNumero && !tieneNomenclatura) {
    return 'Ingresa un formato coherente de dirección con nomenclatura y numeración (ej. Carrera 15 # 85-30 o Calle 72 # 10-34).';
  }
  return null;
}
