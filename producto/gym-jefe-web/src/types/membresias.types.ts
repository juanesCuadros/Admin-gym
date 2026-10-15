import type { EstadoDeportista } from '../utils/estadoDeportista';
import type { PagoMembresiaResponseDto } from './caja.types';

export interface PlanResponse {
  id: string;
  gimnasio_id: string;
  nombre: string;
  precio: number;
  duracion_dias: number;
  tipo: 'individual' | 'pareja' | 'familiar';
  cupo_personas: number;
  activo: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PlanesListResponse {
  items: PlanResponse[];
  total: number;
}

export interface CrearPlanRequest {
  nombre: string;
  precio: number;
  duracion_dias: number;
  tipo: 'individual' | 'pareja' | 'familiar';
  cupo_personas?: number;
}

export interface EditarPlanRequest {
  version: number;
  nombre?: string;
  precio?: number;
  duracion_dias?: number;
  tipo?: 'individual' | 'pareja' | 'familiar';
  cupo_personas?: number;
}

/**
 * Cobro que acompaña la venta de un plan (asignar, cambio de plan o plan grupal). Se registra en el
 * turno propio en la misma operación y no suma días: la vigencia la da el plan. Exige `X-Idempotency-Key`.
 */
export interface PagoVenta {
  monto: number;
  metodo: string;
  tipo_medio: 'efectivo' | 'otro';
  precio_cobrado?: number;
  motivo_descuento?: string;
  valor_recibido?: number;
}

export interface AsignarMembresiaRequest {
  deportista_id: string;
  plan_id: string;
  fecha_inicio?: string;
  pago: PagoVenta;
}

export interface CambiarPlanRequest {
  nuevo_plan_id: string;
  motivo?: string;
  pago: PagoVenta;
}

export interface CancelarMembresiaRequest {
  motivo: string;
}

export interface CongelarMembresiaRequest {
  motivo?: string;
}

export interface MembresiaResponse {
  id: string;
  gimnasio_id: string;
  deportista_id: string;
  plan_id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  cancelada: boolean;
  /** El backend de membresías aún llama así al campo; los valores ya son el enum consolidado (§A4). */
  estado_calculado: EstadoDeportista;
  dias_restantes_o_vencido: number;
  congelamiento_activo: boolean;
  congelamiento_id?: string | null;
  /** Copia del plan en la venta (contrato 1.4): precio de lista de esta membresía. */
  plan_precio_vendido?: number | string | null;
  plan_duracion_dias_vendida?: number | null;
  created_at: string;
  updated_at: string;
  /** Cobro de la venta: solo en las respuestas de asignar y cambiar de plan. */
  pago?: PagoMembresiaResponseDto | null;
}

export interface MembresiaListItemResponse {
  id: string;
  deportista_id: string;
  deportista_nombre: string;
  deportista_documento: string;
  deportista_correo?: string | null;
  deportista_telefono?: string | null;
  plan_id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  cancelada: boolean;
  /** El backend de membresías aún llama así al campo; los valores ya son el enum consolidado (§A4). */
  estado_calculado: EstadoDeportista;
  dias_restantes_o_vencido: number;
  congelamiento_activo: boolean;
  congelamiento_id?: string | null;
  /** Copia del plan en la venta (contrato 1.4): precio de lista de esta membresía. */
  plan_precio_vendido?: number | string | null;
  plan_duracion_dias_vendida?: number | null;
}

export interface MembresiasPaginadasResponse {
  items: MembresiaListItemResponse[];
  total: number;
  skip: number;
  limit: number;
}

export interface CongelamientoItemResponse {
  id: string;
  fecha_inicio: string;
  fecha_fin?: string | null;
  dias?: number | null;
  vigente: boolean;
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface FichaMembresiaResponse {
  membresia: MembresiaResponse;
  congelamientos: CongelamientoItemResponse[];
  pagos: any[];
}

// ---------------------------------------------------------------------------
// Planes grupales (contrato 1.3, GW-RF-52)
// ---------------------------------------------------------------------------

/** `POST /membresias/paquetes`. El titular va incluido en `beneficiarios`. */
export interface CrearPaqueteRequest {
  plan_id: string;
  titular_id: string;
  beneficiarios: string[];
  fecha_inicio?: string;
  pago: PagoVenta;
}

export interface PaqueteMembresiaItemDto {
  id: string;
  deportista_id: string;
  deportista_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  precio_asignado: number | string;
}

export interface CrearPaqueteResponse {
  paquete_id: string;
  membresias: PaqueteMembresiaItemDto[];
  pago: PagoMembresiaResponseDto;
}

/** `GET /membresias/paquetes/{id}`. */
export interface DetallePaqueteResponse {
  id: string;
  plan_nombre: string;
  titular: { id: string; nombre: string; telefono?: string | null };
  membresias: PaqueteMembresiaItemDto[];
}

/** `422 BENEFICIARIOS_INCOMPLETOS`. */
export interface DetallesBeneficiariosIncompletos {
  requeridos: number;
  recibidos: number;
}
