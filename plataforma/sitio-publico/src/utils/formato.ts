const formatoCop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** COP enteros sin decimales: 150000 → "$ 150.000". */
export function formatearCop(valor: number): string {
  return formatoCop.format(Math.round(valor))
}

const formatoEntero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

export function formatearEntero(valor: number): string {
  return formatoEntero.format(valor)
}

/** "1 mes" / "3 meses", "1 día" / "5 días". */
export function plural(n: number, singular: string, pluralTexto: string): string {
  return `${formatearEntero(n)} ${n === 1 ? singular : pluralTexto}`
}
