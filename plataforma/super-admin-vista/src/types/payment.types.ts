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
}

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
