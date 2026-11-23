/** Caja de la estación (fase 3A). Montos en pesos colombianos enteros. */

export interface TurnoLocal {
  id: string;
  staff_id: string;
  abierto_por_nombre: string | null;
  base_inicial: number;
  abierto_en: string;
  /** AAAA-MM-DD, día de Bogotá en que se abrió. */
  fecha_negocio: string;
  /** Se abrió sin red: no se pudo confirmar que no hubiera otro turno abierto en el gimnasio. */
  sin_confirmar: boolean;
  estado: 'abierto' | 'cerrado';
  cerrado_en: string | null;
  cerrado_por_nombre: string | null;
  efectivo_contado: number | null;
  total_esperado_efectivo: number | null;
  diferencia: number | null;
  nota_cierre: string | null;
}

export interface PorMetodo {
  metodo: string;
  tipo_medio: 'efectivo' | 'otro';
  monto: number;
}

export interface TotalesCaja {
  base_inicial: number;
  ventas_efectivo: number;
  ventas_otro: number;
  /** Ventas y renovaciones de membresía. */
  membresias_efectivo: number;
  membresias_otro: number;
  egresos_efectivo: number;
  total_esperado_efectivo: number;
  num_ventas: number;
  num_membresias: number;
  num_egresos: number;
  por_metodo: PorMetodo[];
}

export interface ResumenTurno {
  turno: TurnoLocal;
  totales: TotalesCaja;
}

export interface DatosMostrador {
  metodos_pago: string[];
  precio_pase_dia: number | null;
  precio_pase_clase: number | null;
  permitir_descuentos: boolean;
  tope_descuento_pct: number;
  puede_descontar: boolean;
  puede_operar: boolean;
}

export interface EstadoCaja {
  turno: ResumenTurno | null;
  mostrador: DatosMostrador;
}

export interface ProductoVenta {
  id: string;
  nombre: string;
  precio: number;
  /** Lo que queda, contando lo vendido aquí que aún no ha subido. */
  disponible: number;
}

export type TipoLinea = 'producto' | 'pase_dia' | 'pase_clase';

export interface NuevoItem {
  tipo: TipoLinea;
  producto_id?: string;
  cantidad: number;
  /** Precio de un pase que el gimnasio no tiene configurado. */
  precio?: number;
  precio_cobrado?: number;
  motivo_descuento?: string;
}

export interface NuevaVenta {
  deportista_id?: string;
  items: NuevoItem[];
  metodo?: string;
  pagos?: { metodo: string; monto: number }[];
  valor_recibido?: number;
  /** Anotación de quien cobra (opcional, hasta 300 letras). */
  nota?: string;
}

export interface ItemVendido {
  tipo: TipoLinea;
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_lista: number;
  precio_cobrado: number;
  subtotal: number;
  motivo_descuento: string | null;
}

export interface VentaRegistrada {
  id: string;
  turno_id: string;
  deportista_nombre: string | null;
  items: ItemVendido[];
  total: number;
  tipo_medio: 'efectivo' | 'otro' | 'mixto';
  metodo: string;
  pagos: PorMetodo[];
  valor_recibido: number | null;
  cambio: number | null;
  ocurrida_en: string;
}

export interface EgresoRegistrado {
  id: string;
  turno_id: string;
  monto: number;
  motivo: string;
  ocurrido_en: string;
}

// ---------------------------------------------------------------------------
// Membresías (fase 3B, parte 1)
// ---------------------------------------------------------------------------
export interface MembresiaActual {
  id: string;
  plan_id: string;
  plan_nombre: string;
  fecha_vencimiento: string;
}

export interface Renovacion {
  precio_lista: number;
  dias: number;
  /** AAAA-MM-DD en que quedaría vencida si se renueva hoy. */
  fecha_vencimiento_nueva: string;
}

export interface PlanVenta {
  id: string;
  nombre: string;
  precio: number;
  duracion_dias: number;
  fecha_vencimiento: string;
}

export interface OpcionesMembresia {
  cliente: import('./ingreso.types').ClienteEvaluado;
  membresia: MembresiaActual | null;
  renovacion: Renovacion | null;
  planes: PlanVenta[];
  /** Por qué no se puede cobrar aquí; se hace en la web. */
  aviso: string | null;
}

export interface NuevoCobroMembresia {
  deportista_id: string;
  accion: 'renovar' | 'vender';
  plan_id?: string;
  precio_cobrado?: number;
  motivo_descuento?: string;
  metodo?: string;
  pagos?: { metodo: string; monto: number }[];
  valor_recibido?: number;
  /** Anotación de quien cobra (opcional, hasta 300 letras). */
  nota?: string;
}

export interface CobroMembresiaRegistrado {
  id: string;
  tipo: 'venta' | 'renovacion';
  turno_id: string;
  membresia_id: string;
  deportista_nombre: string;
  plan_nombre: string;
  fecha_vencimiento_anterior: string | null;
  fecha_vencimiento_nueva: string;
  precio_lista: number;
  precio_cobrado: number;
  tipo_medio: 'efectivo' | 'otro' | 'mixto';
  metodo: string;
  pagos: PorMetodo[];
  valor_recibido: number | null;
  cambio: number | null;
  ocurrida_en: string;
}

export interface MovimientoCaja {
  id: string;
  tipo: 'venta' | 'membresia' | 'egreso';
  ocurrido_en: string;
  concepto: string;
  metodo: string;
  /** Positivo lo que entra, negativo lo que sale. */
  monto: number;
  registrado_por: string | null;
  /** Estado de su envío: pendiente, enviando, aplicada, pendiente_revision, error, retenida. */
  envio: string;
}

export interface CierreDiario {
  fecha: string;
  turnos: ResumenTurno[];
  totales: TotalesCaja;
  efectivo_contado: number;
  diferencia: number;
  turnos_abiertos: number;
  sin_subir: number;
}
