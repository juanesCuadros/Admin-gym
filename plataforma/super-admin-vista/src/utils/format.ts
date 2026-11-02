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
  if (val.length > 255) {
    return 'La dirección de la sede no puede exceder los 255 caracteres.';
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

export function validarNombreGym(nombre?: string | null): string | null {
  if (!nombre || nombre.trim() === '') {
    return 'El nombre del gimnasio es obligatorio.';
  }
  const val = nombre.trim();
  if (val.length < 2) {
    return 'El nombre del gimnasio debe tener al menos 2 caracteres.';
  }
  if (val.length > 150) {
    return 'El nombre del gimnasio no puede superar los 150 caracteres.';
  }
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(val)) {
    return 'El nombre del gimnasio debe contener letras.';
  }
  return null;
}

const PATRON_NIT = /^[0-9\.\-]{5,20}$/;

export function validarNit(nit?: string | null): string | null {
  if (!nit || nit.trim() === '') return null;
  const val = nit.trim();
  const digitos = val.replace(/\D/g, '');
  if (digitos.length < 5 || val.length > 20 || !PATRON_NIT.test(val)) {
    return 'El NIT / RUT debe tener al menos 5 dígitos numéricos (ej. 900123456-1).';
  }
  return null;
}

const PATRON_CIUDAD = /^[a-zA-ZáéíóúñÁÉÍÓÚÑ\s\.\-]{3,100}$/;

export function validarCiudad(ciudad?: string | null): string | null {
  if (!ciudad || ciudad.trim() === '') return null;
  const val = ciudad.trim();
  if (val.length < 3) {
    return 'La ciudad debe tener al menos 3 caracteres (ej. Bogotá).';
  }
  if (val.length > 100 || !PATRON_CIUDAD.test(val) || !/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(val)) {
    return 'Ingresa una ciudad válida con letras (ej. Bogotá, Medellín).';
  }
  return null;
}

const PATRON_TELEFONO = /^\+?[0-9\s\-\(\)]{7,20}$/;

export function validarTelefono(telefono?: string | null): string | null {
  if (!telefono || telefono.trim() === '') return null;
  const val = telefono.trim();
  const digitos = val.replace(/\D/g, '');
  if (digitos.length < 7 || digitos.length > 15 || !PATRON_TELEFONO.test(val)) {
    return 'Ingresa un teléfono válido de entre 7 y 15 dígitos (ej. +573001234567 o 6012345678).';
  }
  return null;
}

const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validarCorreo(correo?: string | null): string | null {
  if (!correo || correo.trim() === '') return null;
  const val = correo.trim();
  if (!PATRON_CORREO.test(val)) {
    return 'Ingresa un correo electrónico válido (ej. contacto@gimnasio.com).';
  }
  return null;
}

const PATRON_WHATSAPP = /^\+?[0-9\s\-]{10,20}$/;

export function validarWhatsApp(whatsapp?: string | null): string | null {
  if (!whatsapp || whatsapp.trim() === '') return null;
  const val = whatsapp.trim();
  const digitos = val.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15 || !PATRON_WHATSAPP.test(val)) {
    return 'Ingresa un número de WhatsApp válido de al menos 10 dígitos (ej. +573001234567).';
  }
  return null;
}

export function validarUrl(url?: string | null, etiqueta = 'La URL'): string | null {
  if (!url || url.trim() === '') return null;
  const val = url.trim();
  if (val.length < 8 || !val.toLowerCase().startsWith('http://') && !val.toLowerCase().startsWith('https://')) {
    return `${etiqueta} debe ser una dirección web válida que inicie con https:// o http://.`;
  }
  return null;
}

export function validarRedSocial(usuario?: string | null, red = 'red social'): string | null {
  if (!usuario || usuario.trim() === '') return null;
  const val = usuario.trim();
  if (val.length < 2) {
    return `Ingresa un usuario o enlace válido de ${red}.`;
  }
  if (val.toLowerCase().startsWith('http://') || val.toLowerCase().startsWith('https://')) {
    return null;
  }
  const limpio = val.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_\.]{2,50}$/.test(limpio)) {
    return `Ingresa un usuario válido de ${red} (ej. @gimnasio).`;
  }
  return null;
}

export function validarDescripcion(desc?: string | null): string | null {
  if (!desc || desc.trim() === '') return null;
  const val = desc.trim();
  if (val.length < 5) {
    return 'La descripción debe tener al menos 5 caracteres.';
  }
  if (val.length > 300) {
    return 'La descripción no puede superar los 300 caracteres.';
  }
  return null;
}
