/** Carga inicial de clientes (GW-RF-55, contrato 2.4). */

export type FormatoPlantilla = 'xlsx' | 'csv';

export interface ErrorFilaCarga {
  /** Fila tal como se ve en Excel: el encabezado es la fila 1. */
  fila: number;
  columna: string;
  codigo: string;
  mensaje: string;
}

export interface SimulacionCargaResponse {
  filas_validas: number;
  filas_con_error: number;
  errores: ErrorFilaCarga[];
}

export interface AplicacionCargaResponse {
  deportistas_creados: number;
  membresias_creadas: number;
}
