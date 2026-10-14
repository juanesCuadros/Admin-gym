import type { Monto } from './comun.types';

/** `ProductoResponse` de `app/modules/inventario/schemas.py`. */
export interface ProductoResponse {
  id: string;
  gimnasio_id: string;
  nombre: string;
  precio: Monto;
  stock: number;
  activo: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedProductosResponse {
  items: ProductoResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface CrearProductoRequest {
  nombre: string;
  precio: number;
  stock_inicial: number;
  activo?: boolean;
}

export interface ActualizarProductoRequest {
  nombre: string;
  precio: number;
  version: number;
}

export interface EntradaStockRequest {
  cantidad: number;
  motivo?: string;
}

/** `cantidad` distinta de 0: positiva si sobra, negativa si falta. `motivo` de 10 a 255 caracteres. */
export interface AjusteStockRequest {
  cantidad: number;
  motivo: string;
}

export type TipoMovimientoStock = 'entrada' | 'ajuste' | 'venta' | 'devolucion';

export interface StockMovimientoResponse {
  id: string;
  producto_id: string;
  producto_nombre?: string | null;
  tipo: TipoMovimientoStock | string;
  cantidad: number;
  motivo?: string | null;
  registrado_por?: string | null;
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface PaginatedStockMovimientosResponse {
  items: StockMovimientoResponse[];
  total: number;
  limit: number;
  offset: number;
}
