/**
 * Módulo 09 · Personal (`/personal`). Formas de `app/modules/personal/schemas.py`
 * y del contrato 2.7 de `docs/CONTRATOS-API.md` (credencial temporal).
 */

export type RolStaff = 'recepcionista' | 'entrenador';
export type RolUsuario = RolStaff | 'jefe';

export interface StaffResponse {
  id: string;
  gimnasio_id: string;
  nombre: string;
  correo: string;
  rol: RolUsuario | string;
  activo: boolean;
  ultimo_ingreso?: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StaffListResponse {
  items: StaffResponse[];
  total: number;
  pagina: number;
  limite: number;
  total_paginas: number;
}

export interface FiltrosStaff {
  buscar?: string;
  rol?: string;
  activo?: boolean;
  pagina?: number;
  limite?: number;
}

/** Contrato 2.7: ya no se envía contraseña; el servidor genera una temporal. */
export interface CrearStaffRequest {
  nombre: string;
  correo: string;
  rol: RolStaff;
}

/** Contrato 2.7: la contraseña temporal se muestra una sola vez. */
export interface CredencialTemporal {
  password_temporal: string;
  /** Instante ISO-8601 (72 h después de generarla). */
  expira_en: string;
}

export type CrearStaffResponse = StaffResponse & Partial<CredencialTemporal>;

export interface ActualizarStaffRequest {
  nombre: string;
  correo: string;
  rol: RolStaff;
  version: number;
}

export interface CambiarEstadoStaffRequest {
  activo: boolean;
  motivo?: string;
}

export interface CambiarEstadoStaffResponse {
  id: string;
  nombre: string;
  activo: boolean;
  turno_cerrado_forzado: boolean;
  turno_id_cerrado?: string | null;
  mensaje: string;
}

export interface TransferirJefeRequest {
  nuevo_jefe_id: string;
  nuevo_rol_antiguo_jefe: RolStaff;
  password_confirmacion: string;
}

export interface TransferirJefeResponse {
  antiguo_jefe_id: string;
  antiguo_jefe_nuevo_rol: string;
  nuevo_jefe_id: string;
  nuevo_jefe_nombre: string;
  mensaje: string;
}
