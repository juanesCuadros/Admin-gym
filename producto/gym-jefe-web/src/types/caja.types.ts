import type { Monto } from './comun.types';

export interface AbrirTurnoRequest {
  base_inicial: number;
}

export interface CerrarTurnoRequest {
  efectivo_contado: number;
}

/** Contrato 1.1 · `POST /caja/turnos/{id}/cerrar-ajeno`. */
export interface CerrarTurnoAjenoRequest {
  conteo_efectivo: number;
  nota?: string;
}

/** Contrato 1.1 · `detalles` de `409 TURNO_AJENO_ABIERTO`. */
export interface DetallesTurnoAjeno {
  turno_id: string;
  abierto_por_nombre: string;
  abierto_en: string;
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
  /** Contrato 1.1: el turno abierto es de quien consulta. */
  es_propio?: boolean;
  abierto_por_nombre?: string | null;
  /** Contrato 1.1: solo en la respuesta de cerrar un turno ajeno. */
  cerrado_por_nombre?: string | null;
  descuadre_atribuido_a_nombre?: string | null;
}

export interface VentaItemRequest {
  tipo: 'producto' | 'pase_dia' | 'pase_clase';
  producto_id?: string;
  descripcion: string;
  cantidad: number;
  precio_unitario?: number;
  /** Contrato 1.2 (GW-RF-53): si se omite se cobra el precio de lista. */
  precio_cobrado?: number;
  /** Contrato 1.2: obligatorio si `precio_cobrado` es menor al precio de lista. */
  motivo_descuento?: string;
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
  /** Contrato 1.2 (pendiente de backend). */
  precio_lista?: number;
  precio_cobrado?: number;
  descuento_pct?: number;
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
  idempotency_key?: string;
  idempotente_reintento?: boolean;
}

export interface RegistrarPagoMembresiaRequest {
  /** Membresía individual. Va esto o `paquete_id`, nunca los dos. */
  membresia_id?: string;
  /** Contrato 1.3: un solo pago cubre todas las membresías del paquete. */
  paquete_id?: string;
  /** Valor que se cobra (COP enteros). */
  monto: number;
  metodo: string;
  tipo_medio: 'efectivo' | 'otro';
  /** 0 = la duración del plan. */
  dias_agregados: number;
  valor_recibido?: number;
  /** Contrato 1.2: si se omite se cobra el precio de lista. */
  precio_cobrado?: number;
  /** Contrato 1.2: obligatorio si `precio_cobrado` es menor al precio de lista. */
  motivo_descuento?: string;
}

/** `422 DESCUENTO_SUPERA_TOPE` (contrato 1.2). */
export interface DetallesDescuentoSuperaTope {
  tope_pct: number;
}

export interface PagoMembresiaResponseDto {
  id: string;
  turno_id: string;
  membresia_id?: string | null;
  paquete_id?: string | null;
  monto: Monto;
  metodo: string;
  tipo_medio: string;
  dias_agregados: number;
  nueva_fecha_vencimiento?: string | null;
  /** Contrato 1.2. */
  precio_lista?: Monto | null;
  precio_cobrado?: Monto | null;
  descuento_pct?: Monto | null;
  motivo_descuento?: string | null;
  idempotency_key?: string;
  idempotente_reintento?: boolean;
  valor_recibido?: Monto | null;
  cambio_devuelto?: Monto | null;
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
