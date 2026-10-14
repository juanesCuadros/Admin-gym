/** Validaciones del formulario de registro. Reflejan las reglas de SignupRequest en super-admin-api. */

export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

/**
 * Teléfono colombiano de 10 dígitos: celular (empieza por 3) o fijo (empieza por 60).
 * Acepta el indicativo +57 y espacios o guiones; devuelve solo los 10 dígitos.
 */
export function normalizarTelefono(valor: string): string {
  let digitos = soloDigitos(valor)
  if (digitos.length === 12 && digitos.startsWith('57')) digitos = digitos.slice(2)
  return digitos
}

export function validarTelefono(valor: string): string | null {
  if (!valor.trim()) return 'Escribe un teléfono de contacto.'
  const digitos = normalizarTelefono(valor)
  if (digitos.length !== 10) return 'El teléfono debe tener 10 dígitos, por ejemplo 300 123 4567.'
  if (!digitos.startsWith('3') && !digitos.startsWith('60')) {
    return 'Escribe un celular (empieza por 3) o un fijo con indicativo (empieza por 60).'
  }
  return null
}

const PATRON_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validarCorreo(valor: string): string | null {
  const v = valor.trim()
  if (!v) return 'Escribe tu correo.'
  if (v.length > 254 || !PATRON_CORREO.test(v)) return 'Revisa el correo; debe ser del tipo nombre@dominio.com.'
  return null
}

export function validarTexto(valor: string, campo: string, min: number, max: number): string | null {
  const v = valor.trim()
  if (!v) return `Escribe ${campo}.`
  if (v.length < min) return `Debe tener al menos ${min} caracteres.`
  if (v.length > max) return `Debe tener como máximo ${max} caracteres.`
  return null
}

/** El subdominio se arma con letras y números; un nombre solo con símbolos no sirve. */
export function validarNombreGimnasio(valor: string): string | null {
  const error = validarTexto(valor, 'el nombre del gimnasio', 2, 150)
  if (error) return error
  if (!/[a-z0-9]/i.test(valor.normalize('NFKD'))) return 'El nombre debe tener letras o números.'
  return null
}
