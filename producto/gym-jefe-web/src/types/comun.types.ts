/**
 * Tipos compartidos entre módulos.
 */

/** Dinero en COP. El backend serializa `Decimal` como texto (`"80000.00"`): se convierte con `Number()`. */
export type Monto = number | string;

/**
 * Fila de `GET /deportistas/buscar` (autocompletado).
 * Contrato 2.1: `estado` usa el enum consolidado del deportista.
 */
export interface DeportistaBusquedaItem {
  id: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  activo: boolean;
  tipo_documento?: string;
  estado?: string;
}
