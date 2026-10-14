// Tipos escritos a mano desde plataforma/super-admin-api/app/presentation/schemas/plan_request_schemas.py

export type EstadoSolicitudPlan = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada';

export interface SolicitudPlan {
  id: string;
  gimnasio: { id: string; nombre: string; subdominio: string };
  plan: { id: string; nombre: string; precio: number; duracion_meses?: number | null };
  solicitado_por: string;
  nota?: string | null;
  created_at: string;
  estado: EstadoSolicitudPlan;
  motivo_rechazo?: string | null;
  resuelta_en?: string | null;
}

/** Cuerpo de la aprobación. La `Idempotency-Key` va en el encabezado. */
export interface AprobarSolicitudRequest {
  monto: number;
  fecha_pago?: string;
  metodo: string;
  nota?: string;
}

export interface RechazarSolicitudRequest {
  motivo: string;
}

export interface AprobacionResponse {
  solicitud_id: string;
  estado: string;
  pago_id: string;
  monto: number;
  meses: number;
  fecha_pago: string;
  plan_id: string;
  plan_nombre: string;
  suscripcion_id: string;
  nueva_fecha_corte?: string | null;
  estado_gimnasio: string;
  /** SA-RF-16 CA5: el monto no coincide con precio × meses. No bloquea. */
  aviso_monto?: string | null;
}
