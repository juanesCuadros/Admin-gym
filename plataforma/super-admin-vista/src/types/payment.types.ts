// Tipos escritos a mano desde plataforma/super-admin-api/app/presentation/schemas/payment_schemas.py
export interface Payment {
  id: string;
  gimnasio_id: string;
  monto: number;
  meses: number;
  fecha_pago: string;
  metodo: string;
  nota?: string | null;
  anulado: boolean;
  motivo_anulacion?: string | null;
  anulado_en?: string | null;
  idempotency_key: string;
  created_at: string;
  nueva_fecha_corte?: string | null;
  fija_ancla?: boolean;
  /** SA-RF-09 CA5: al anular el pago de reactivación, el estado no se revierte. */
  advertencia?: string | null;
}

/**
 * Cuerpo de `POST /admin/gyms/{id}/payments` y del `pago` en el cambio de estado.
 * `fecha_pago` no puede ser futura (422 FECHA_PAGO_FUTURA); si se omite, el servidor usa hoy (Bogotá).
 */
export interface PaymentCreate {
  monto: number;
  meses: number;
  fecha_pago?: string;
  metodo: string;
  nota?: string;
  idempotency_key: string;
}

export interface PaymentVoidRequest {
  motivo_anulacion: string;
}

export interface SubscriptionUpdatePrice {
  nuevo_valor_mensual: number;
  vigente_desde?: string;
}
