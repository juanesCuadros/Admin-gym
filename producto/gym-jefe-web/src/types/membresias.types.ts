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

export interface AsignarMembresiaRequest {
  deportista_id: string;
  plan_id: string;
  fecha_inicio?: string;
}

export interface CambiarPlanRequest {
  nuevo_plan_id: string;
  motivo?: string;
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
  estado_calculado: 'activo' | 'por_vencer' | 'mora' | 'vencido' | 'congelado' | 'cancelada';
  dias_restantes_o_vencido: number;
  congelamiento_activo: boolean;
  congelamiento_id?: string | null;
  created_at: string;
  updated_at: string;
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
  estado_calculado: string;
  dias_restantes_o_vencido: number;
  congelamiento_activo: boolean;
  congelamiento_id?: string | null;
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
