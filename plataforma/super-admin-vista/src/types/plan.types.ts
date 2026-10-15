// Tipos escritos a mano desde plataforma/super-admin-api/app/presentation/schemas/plan_schemas.py

export type TipoPlan = 'prueba' | 'pago';

export interface Plan {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoPlan;
  /** COP enteros. */
  precio: number;
  duracion_meses?: number | null;
  dias_prueba?: number | null;
  max_clientes_activos?: number | null;
  max_staff?: number | null;
  activo: boolean;
  publico: boolean;
  orden: number;
  version: number;
  gimnasios_actuales: number;
}

/** Campos editables comunes a crear y editar. */
export interface PlanBase {
  nombre: string;
  descripcion?: string | null;
  precio: number;
  /** Solo planes de pago (1–36). */
  duracion_meses?: number | null;
  /** Solo el plan de prueba (1–90). */
  dias_prueba?: number | null;
  /** null = sin límite. */
  max_clientes_activos?: number | null;
  /** null = sin límite. */
  max_staff?: number | null;
  publico: boolean;
  orden: number;
}

export interface PlanCreate extends PlanBase {
  /** `^[a-z0-9_]{2,40}$`. No se edita después. */
  codigo: string;
  tipo: TipoPlan;
  activo: boolean;
}

/** `codigo` y `tipo` no se envían: si llegan, la API responde 422 CAMPO_NO_EDITABLE. */
export interface PlanUpdate extends PlanBase {
  version: number;
}

export interface PlanStatusUpdate {
  activo: boolean;
}

export interface CambioPlanRequest {
  plan_id: string;
  /** Por defecto, hoy (Bogotá). No puede ser anterior a la vigencia actual (422 VIGENCIA_INVALIDA). */
  vigente_desde?: string;
}

export interface CambioPlanResponse {
  gimnasio_id: string;
  plan_id: string;
  plan_nombre: string;
  suscripcion_id: string;
  valor_mensual: number;
  vigente_desde: string;
}
