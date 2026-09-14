import { Payment } from './payment.types';
import { AuditLog } from './audit.types';

export type GymState = 'prueba' | 'activo' | 'suspendido' | 'cancelado';

export interface JefeAccountCreate {
  nombre: string;
  correo: string;
  telefono?: string;
}

export interface SubscriptionCreate {
  valor_mensual: number;
  tipo_inicio: 'prueba' | 'cliente_activo';
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

export interface GymStateChangeRequest {
  nuevo_estado: GymState;
  motivo?: string;
}

export interface GymCancelRequest {
  motivo: string;
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
