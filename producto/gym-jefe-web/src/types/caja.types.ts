export interface AbrirTurnoRequest {
  base_inicial: number;
}

export interface CerrarTurnoRequest {
  efectivo_contado: number;
}

export interface CierreForzadoRequest {
  motivo: string;
  efectivo_contado?: number;
}

export interface TurnoResumenDto {
  id: string;
  gimnasio_id: string;
  staff_id: string;
  staff_nombre?: string | null;
  base_inicial: number;
  abierto_en: string;
  cerrado_en?: string | null;
  estado: 'abierto' | 'cerrado';
  ventas_efectivo: number;
  ventas_otro: number;
  pagos_membresia_efectivo: number;
  pagos_membresia_otro: number;
  egresos_efectivo: number;
  devoluciones_efectivo: number;
  total_esperado_efectivo: number;
  efectivo_contado?: number | null;
  diferencia?: number | null;
  cierre_forzado: boolean;
  revisado_en?: string | null;
}

export interface VentaItemRequest {
  tipo: 'producto' | 'pase_dia' | 'pase_clase';
  producto_id?: string;
  descripcion: string;
  cantidad: number;
  precio_unitario?: number;
}

export interface RegistrarVentaRequest {
  deportista_id?: string;
  metodo: string;
  tipo_medio: 'efectivo' | 'otro';
  valor_recibido?: number;
  items: VentaItemRequest[];
}

export interface VentaItemResponseDto {
  id: string;
  tipo: string;
  producto_id?: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface VentaResponseDto {
  id: string;
  turno_id: string;
  deportista_id?: string | null;
  total: number;
  metodo: string;
  tipo_medio: string;
  valor_recibido?: number | null;
  cambio_devuelto?: number | null;
  anulada: boolean;
  motivo_anulacion?: string | null;
  items: VentaItemResponseDto[];
  created_at: string;
}

export interface RegistrarPagoMembresiaRequest {
  membresia_id: string;
  monto: number;
  metodo: string;
  tipo_medio: 'efectivo' | 'otro';
  dias_agregados: number;
  valor_recibido?: number;
}

export interface PagoMembresiaResponseDto {
  id: string;
  turno_id: string;
  membresia_id: string;
  monto: number;
  metodo: string;
  tipo_medio: string;
  dias_agregados: number;
  nueva_fecha_vencimiento: string;
  valor_recibido?: number | null;
  cambio_devuelto?: number | null;
  anulado: boolean;
  motivo_anulacion?: string | null;
  created_at: string;
}

export interface RegistrarEgresoRequest {
  monto: number;
  motivo: string;
}

export interface EgresoResponseDto {
  id: string;
  turno_id: string;
  monto: number;
  motivo: string;
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface MovimientoCajaItemDto {
  id: string;
  tipo_movimiento: 'venta' | 'pago_membresia' | 'egreso' | 'devolucion';
  monto: number;
  metodo?: string | null;
  tipo_medio?: string | null;
  concepto: string;
  anulado: boolean;
  ts: string;
}

export interface HistorialMovimientosTurnoResponse {
  turno_id: string;
  total_movimientos: number;
  items: MovimientoCajaItemDto[];
}
