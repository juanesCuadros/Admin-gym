/** Etiquetas de los tipos de movimiento del kardex (`stock_movimientos.tipo`). */
export const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  entrada: 'Entrada',
  ajuste: 'Ajuste',
  venta: 'Venta',
  devolucion: 'Devolución',
};

export const VARIANTE_MOVIMIENTO: Record<string, 'success' | 'warning' | 'info' | 'neutral'> = {
  entrada: 'success',
  ajuste: 'warning',
  venta: 'info',
  devolucion: 'neutral',
};
