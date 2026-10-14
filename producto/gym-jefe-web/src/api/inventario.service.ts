import { apiClient } from './client';
import type {
  ActualizarProductoRequest,
  AjusteStockRequest,
  CrearProductoRequest,
  EntradaStockRequest,
  PaginatedProductosResponse,
  PaginatedStockMovimientosResponse,
  ProductoResponse,
  StockMovimientoResponse,
} from '../types/inventario.types';

/** Módulo 08 · Inventario (`/inventario`). */
export const inventarioService = {
  async listarProductos(params: {
    buscar?: string;
    activo?: boolean;
    bajo_stock?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedProductosResponse> {
    const res = await apiClient.get<PaginatedProductosResponse>('/inventario/productos', { params });
    return res.data;
  },

  async obtenerProducto(id: string): Promise<ProductoResponse> {
    const res = await apiClient.get<ProductoResponse>(`/inventario/productos/${id}`);
    return res.data;
  },

  async crearProducto(data: CrearProductoRequest): Promise<ProductoResponse> {
    const res = await apiClient.post<ProductoResponse>('/inventario/productos', data);
    return res.data;
  },

  async actualizarProducto(id: string, data: ActualizarProductoRequest): Promise<ProductoResponse> {
    const res = await apiClient.put<ProductoResponse>(`/inventario/productos/${id}`, data);
    return res.data;
  },

  async cambiarEstadoProducto(id: string, activo: boolean): Promise<ProductoResponse> {
    const res = await apiClient.patch<ProductoResponse>(`/inventario/productos/${id}/estado`, { activo });
    return res.data;
  },

  async registrarEntrada(id: string, data: EntradaStockRequest): Promise<StockMovimientoResponse> {
    const res = await apiClient.post<StockMovimientoResponse>(`/inventario/productos/${id}/entrada`, data);
    return res.data;
  },

  async registrarAjuste(id: string, data: AjusteStockRequest): Promise<StockMovimientoResponse> {
    const res = await apiClient.post<StockMovimientoResponse>(`/inventario/productos/${id}/ajuste`, data);
    return res.data;
  },

  async kardexProducto(
    id: string,
    params: { limit?: number; offset?: number }
  ): Promise<PaginatedStockMovimientosResponse> {
    const res = await apiClient.get<PaginatedStockMovimientosResponse>(`/inventario/productos/${id}/kardex`, {
      params,
    });
    return res.data;
  },

  async kardexGeneral(params: {
    tipo?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedStockMovimientosResponse> {
    const res = await apiClient.get<PaginatedStockMovimientosResponse>('/inventario/kardex', { params });
    return res.data;
  },
};
