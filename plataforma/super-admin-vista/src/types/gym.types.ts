// Tipos escritos a mano desde plataforma/super-admin-api/app/presentation/schemas/gym_schemas.py
import { Payment, PaymentCreate } from './payment.types';
import { AuditLog } from './audit.types';

/** Estado guardado del gimnasio (§2.1). */
export type GymState = 'prueba' | 'activo' | 'suspendido' | 'cancelado';

/** Estado calculado por `platform.estado_suscripcion()` (§2.2). Nunca se guarda. */
export type EstadoCalculado = 'al_dia' | 'por_vencer' | 'en_gracia' | 'bloqueado';

/** Valores que acepta el filtro `estado_calculado=` de `GET /admin/gyms`. */
export type FiltroEstadoCalculado = EstadoCalculado | 'prueba_por_vencer';

export type TipoInicio = 'prueba' | 'cliente_activo';

export interface JefeAccountCreate {
  nombre: string;
  correo: string;
  telefono?: string;
}

export interface SubscriptionCreate {
  valor_mensual: number;
  tipo_inicio: TipoInicio;
}

export interface GymCreateStepByStep {
  nombre: string;
  subdominio?: string;
  nit?: string;
  direccion?: string;
  ciudad?: string;
  telefono?: string;
  correo?: string;

  logo_url?: string;
  banner_url?: string;
  descripcion?: string;
  instagram?: string;
  facebook?: string;
  whatsapp?: string;

  jefe: JefeAccountCreate;
  suscripcion: SubscriptionCreate;
}

export interface GymUpdate {
  nombre?: string;
  nit?: string;
  direccion?: string;
  ciudad?: string;
  telefono?: string;
  correo?: string;
  logo_url?: string;
  banner_url?: string;
  descripcion?: string;
  instagram?: string;
  facebook?: string;
  whatsapp?: string;
}

/**
 * `PATCH /admin/gyms/{id}/status` (SA-RF-09).
 * - `activo`: exige `pago` (activar una prueba o reactivar un suspendido).
 * - `suspendido` / `cancelado`: exige `motivo` (mín. 5 caracteres).
 * - Pedir el estado actual o una transición no permitida responde 422.
 */
export interface GymStateChangeRequest {
  nuevo_estado: GymState;
  motivo?: string;
  pago?: PaymentCreate;
}

export interface GymCancelRequest {
  motivo: string;
}

export interface GymDeleteRequest {
  confirmar_subdominio: string;
}

export interface GymDeleteResponse {
  id: string;
  subdominio_liberado: string;
  eliminado_en: string;
}

export interface SubdomainCheckResponse {
  subdominio: string;
  disponible: boolean;
  valido: boolean;
  mensaje: string;
}

export interface JefeResponse {
  id: string;
  nombre: string;
  correo: string;
  telefono?: string | null;
  password_cambiada: boolean;
  ultimo_ingreso?: string | null;
}

export interface SubscriptionResponse {
  id: string;
  valor_mensual: number;
  tipo_inicio: string;
  vigente_desde: string;
  vigente_hasta?: string | null;
  plan_id?: string | null;
  plan_nombre?: string | null;
}

export interface GymListItem {
  id: string;
  gimnasio_id: string;
  nombre: string;
  subdominio: string;
  ciudad?: string | null;
  telefono?: string | null;
  estado: GymState;
  fecha_inicio: string;
  fecha_corte?: string | null;
  dias_restantes?: number | null;
  estado_calculado?: EstadoCalculado | null;
  motivo_bloqueo?: string | null;
  plan_nombre?: string | null;
  logo_url?: string | null;
  jefe_nombre?: string | null;
  jefe_correo?: string | null;
  valor_mensual?: number | null;
  created_at: string;
}

export interface GymDetail {
  id: string;
  gimnasio_id: string;
  nombre: string;
  subdominio: string;
  url_acceso: string;
  nit?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  telefono?: string | null;
  correo?: string | null;
  estado: GymState;
  fecha_inicio: string;
  fecha_corte?: string | null;
  dias_restantes?: number | null;
  estado_calculado?: EstadoCalculado | null;
  motivo_bloqueo?: string | null;
  plan_nombre?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  descripcion?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  whatsapp?: string | null;
  motivo_cancelacion?: string | null;
  fecha_cancelacion?: string | null;
  created_at: string;
  updated_at: string;
  cuenta_jefe?: JefeResponse | null;
  suscripcion_actual?: SubscriptionResponse | null;
  suscripciones_historial: SubscriptionResponse[];
  total_pagos_registrados: number;
  historial_pagos: Payment[];
  actividad_reciente: AuditLog[];
  /** Solo en la respuesta de cancelar (contrato 3.4). Se muestra una sola vez. */
  export_url?: string | null;
  export_expira_en?: string | null;
}

export interface CredentialsIssuanceResponse {
  gimnasio_id: string;
  gimnasio_nombre: string;
  correo_jefe: string;
  url_acceso: string;
  password_temporal: string;
  expira_en: string;
  tipo: string;
  whatsapp_copiable: string;
  mensaje: string;
}

export interface GymCreateResponse {
  gimnasio: {
    id: string;
    gimnasio_id: string;
    nombre: string;
    subdominio: string;
    estado: GymState;
    fecha_inicio: string;
    fecha_corte?: string | null;
  };
  credenciales: CredentialsIssuanceResponse;
}
