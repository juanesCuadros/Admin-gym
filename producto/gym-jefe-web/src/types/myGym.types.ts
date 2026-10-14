/**
 * Módulo 11 · MyGymOS (`/my-gym`). Formas tomadas de `app/modules/my_gym/schemas.py`
 * y de `docs/CONTRATOS-API.md` §2.5 y §2.6 (marcadas como contrato).
 */

/** Parámetros del contrato 2.5: el backend actual aún no los devuelve, por eso son opcionales. */
export interface ParametrosContrato25 {
  minimo_dias_congelamiento?: number;
  permitir_descuentos?: boolean;
  tope_descuento_pct?: number;
  ventana_reserva_dias?: number;
  limite_cancelar_reserva_horas?: number;
}

export interface InfoGymResponse extends ParametrosContrato25 {
  id: string;
  nombre: string;
  subdominio: string;
  zona_horaria: string;
  direccion?: string | null;
  ciudad?: string | null;
  telefono?: string | null;
  correo?: string | null;
  redes: Record<string, string | null>;
  horarios?: Record<string, string> | null;
  metodos_pago: string[];
  dias_gracia_mora: number;
  tope_dias_congelamiento: number;
  dias_umbral_por_vencer: number;
  duracion_sesion_minutos: number;
  branding: Record<string, unknown>;
  version: number;
  activo: boolean;
  updated_at: string;
}

export interface ActualizarInfoGymRequest {
  version: number;
  nombre: string;
  direccion?: string | null;
  ciudad?: string | null;
  telefono?: string | null;
  correo?: string | null;
  redes?: Record<string, string | null>;
  horarios?: Record<string, string>;
}

export interface ActualizarBrandingRequest {
  version: number;
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
}

export interface ActualizarMetodosPagoRequest {
  version: number;
  metodos_pago: string[];
}

export interface ActualizarParametrosRequest extends ParametrosContrato25 {
  version: number;
  dias_gracia_mora: number;
  tope_dias_congelamiento: number;
  dias_umbral_por_vencer: number;
  duracion_sesion_minutos?: number;
}

export interface ParametrosTenantResponse extends ParametrosContrato25 {
  dias_gracia_mora: number;
  tope_dias_congelamiento: number;
  dias_umbral_por_vencer: number;
  duracion_sesion_minutos: number;
  version: number;
}

export interface LandingInfoResponse {
  subdominio: string;
  landing_slug?: string | null;
  landing_url: string;
  qr_data: string;
  qr_svg: string;
  es_solo_lectura: boolean;
  mensaje: string;
}

// --- Auditoría (RF-49, RF-50) ---

export interface AuditoriaGymItemResponse {
  id: number;
  created_at: string;
  actor_id?: string | null;
  actor_nombre: string;
  impersonando: boolean;
  accion: string;
  entidad: string;
  entidad_id?: string | null;
  detalle?: Record<string, unknown> | null;
  hash_previo?: string | null;
  hash_actual: string;
}

export interface AuditoriaPaginadaResponse {
  items: AuditoriaGymItemResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface AuditoriaFiltrosDisponiblesResponse {
  acciones: string[];
  entidades: string[];
}

export interface FiltrosAuditoria {
  fecha_inicio?: string;
  fecha_fin?: string;
  actor_id?: string;
  accion?: string;
  entidad?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

// --- Mi suscripción (contrato 2.6, pendiente de backend) ---

export interface PlanActualSaas {
  codigo: string;
  nombre: string;
  tipo: string;
  max_clientes_activos?: number | null;
  max_staff?: number | null;
}

export interface SolicitudPlanPendiente {
  id: string;
  plan_nombre: string;
  solicitado_por: string;
  created_at: string;
}

export interface MiPlanResponse {
  plan_actual?: PlanActualSaas | null;
  uso: { clientes_activos: number; staff: number };
  solicitud_pendiente?: SolicitudPlanPendiente | null;
}

export interface PlanSaasDisponible {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  precio: number | string;
  duracion_meses: number;
  max_clientes_activos?: number | null;
  max_staff?: number | null;
}

export interface SolicitarPlanRequest {
  plan_id: string;
  nota?: string;
}
