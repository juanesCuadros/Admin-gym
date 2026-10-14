/**
 * Tipos compartidos entre módulos.
 */

/** Dinero en COP. El backend serializa `Decimal` como texto (`"80000.00"`): se convierte con `Number()`. */
export type Monto = number | string;

/**
 * Fila de `GET /deportistas/buscar` (autocompletado).
 * El backend aún devuelve `estado_membresia` con el enum viejo; no se usa en la UI (§A4, contrato 2.1).
 */
export interface DeportistaBusquedaItem {
  id: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  activo: boolean;
}
