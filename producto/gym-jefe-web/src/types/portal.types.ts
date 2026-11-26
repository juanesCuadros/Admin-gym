/**
 * Tipos de datos para el Portal del Deportista.
 */

export interface DeportistaAuthPerfilDto {
  id: string;
  cuenta_id: string;
  gimnasio_id: string;
  gimnasio_nombre: string;
  subdominio: string;
  nombre: string;
  documento: string;
  correo: string;
  telefono?: string | null;
}

export interface IniciarAccesoDeportistaResponse {
  paso_siguiente: 'pin' | 'password';
  correo: string;
  mensaje: string;
  vigencia_minutos: number;
}

export interface ValidarPinDeportistaResponse {
  valido: boolean;
  setup_token: string;
  mensaje: string;
}

export interface LoginDeportistaResponse {
  access_token: string;
  deportista: DeportistaAuthPerfilDto;
}

export interface MembresiaPortalResumenDto {
  id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  dias_restantes: number;
  estado: string;
  congelada: boolean;
  precio: number | string;
}

export interface PerfilDeportistaResponse {
  id: string;
  gimnasio_nombre: string;
  subdominio: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  sexo?: 'M' | 'F' | 'otro' | null;
  fecha_nacimiento?: string | null;
  altura_cm?: number | string | null;
  acudiente_nombre?: string | null;
  estado_general: string;
  membresia_actual?: MembresiaPortalResumenDto | null;
  total_asistencias_mes: number;
  total_asistencias_historico: number;
  ultimo_peso_kg?: number | string | null;
  ultimo_grasa_pct?: number | string | null;
  ultimo_masa_muscular_kg?: number | string | null;
  version: number;
}

export interface ActualizarPerfilDeportistaRequest {
  nombre: string;
  telefono?: string | null;
  sexo?: 'M' | 'F' | 'otro' | null;
  fecha_nacimiento?: string | null;
  altura_cm?: number | null;
  acudiente_nombre?: string | null;
}

export interface PagoMembresiaPortalItem {
  id: string;
  membresia_id: string;
  plan_nombre: string;
  monto: number | string;
  metodo: string;
  dias_agregados: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  anulado: boolean;
  created_at: string;
}

export interface CompraItemPortalDto {
  id: string;
  tipo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number | string;
  subtotal: number | string;
}

export interface CompraTiendaPortalItem {
  id: string;
  total: number | string;
  metodo: string;
  anulada: boolean;
  created_at: string;
  items: CompraItemPortalDto[];
}

export interface FinanzasDeportistaResponse {
  total_invertido_membresias: number | string;
  total_compras_tienda: number | string;
  cantidad_pagos_membresia: number;
  cantidad_compras_tienda: number;
  pagos_membresias: PagoMembresiaPortalItem[];
  compras_tienda: CompraTiendaPortalItem[];
}

export interface RegistrarMedicionPortalRequest {
  fecha?: string;
  sexo?: 'M' | 'F';
  altura_cm?: number;
  peso: number;
  cintura?: number;
  cadera?: number;
  pecho?: number;
  brazo?: number;
  pierna?: number;
}

export interface MedicionPortalItem {
  id: string;
  fecha: string;
  peso?: number | string | null;
  imc?: number | string | null;
  grasa_pct?: number | string | null;
  masa_muscular?: number | string | null;
  cintura?: number | string | null;
  cadera?: number | string | null;
  pecho?: number | string | null;
  brazo?: number | string | null;
  pierna?: number | string | null;
  origen: 'deportista' | 'staff';
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface ProgresoResumenDto {
  total_registros: number;
  peso_inicial?: number | string | null;
  peso_actual?: number | string | null;
  cambio_peso?: number | string | null;
  grasa_inicial?: number | string | null;
  grasa_actual?: number | string | null;
  cambio_grasa?: number | string | null;
  musculo_inicial?: number | string | null;
  musculo_actual?: number | string | null;
  cambio_musculo?: number | string | null;
  cintura_inicial?: number | string | null;
  cintura_actual?: number | string | null;
  cambio_cintura?: number | string | null;
  imc_actual?: number | string | null;
  altura_cm?: number | string | null;
  sexo?: string | null;
}

export interface MedicionesPortalResponse {
  resumen: ProgresoResumenDto;
  historial: MedicionPortalItem[];
}

export interface AsistenciaPortalItem {
  id: number;
  fecha_hora: string;
  fecha_local: string;
  hora_local: string;
  metodo: string;
  resultado: string;
}

export interface AsistenciasPortalResponse {
  asistencias_mes_actual: number;
  asistencias_ultimos_30_dias: number;
  asistencias_totales: number;
  dias_asistidos_mes: string[];
  historial: AsistenciaPortalItem[];
}

