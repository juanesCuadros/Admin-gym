export interface CrearDeportistaRequest {
  documento: string;
  nombre: string;
  correo?: string;
  telefono?: string;
  sexo?: 'M' | 'F' | 'otro';
  fecha_nacimiento?: string;
  altura_cm?: number;
  consentimiento_1581: boolean;
  acudiente_nombre?: string;
}

export interface EditarDeportistaRequest {
  version: number;
  documento?: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
  sexo?: 'M' | 'F' | 'otro';
  fecha_nacimiento?: string;
  altura_cm?: number;
  acudiente_nombre?: string;
}

export interface DeportistaResumenResponse {
  id: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  activo: boolean;
  estado_membresia: string; // al_dia, por_vencer, en_mora, vencido, congelado, sin_membresia
  plan_nombre?: string | null;
  fecha_vencimiento?: string | null;
  version: number;
  created_at: string;
}

export interface DeportistasPaginadosResponse {
  items: DeportistaResumenResponse[];
  total: number;
  skip: number;
  limit: number;
}

export interface DeportistaResponse {
  id: string;
  gimnasio_id: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  sexo?: string | null;
  fecha_nacimiento?: string | null;
  altura_cm?: number | null;
  consentimiento_1581: boolean;
  consentimiento_fecha?: string | null;
  acudiente_nombre?: string | null;
  activo: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MembresiaFichaResponse {
  id: string;
  plan_id: string;
  plan_nombre: string;
  fecha_inicio: string;
  fecha_vencimiento: string;
  cancelada: boolean;
  dias_restantes: number;
  congelado: boolean;
  estado: string;
}

export interface PagoFichaResponse {
  id: string;
  monto: number;
  metodo: string;
  tipo_medio: string;
  dias_agregados: number;
  anulado: boolean;
  created_at: string;
}

export interface AccesoFichaResponse {
  id: number;
  tipo: string;
  metodo: string;
  resultado: string;
  ts_bogota: string;
}

export interface HuellaInfoResponse {
  id: string;
  dedo: string;
  created_at: string;
}

export interface MedicionCorporalResponse {
  id: string;
  fecha: string;
  peso?: number | null;
  grasa_pct?: number | null;
  masa_muscular?: number | null;
  cintura?: number | null;
  cadera?: number | null;
  brazo?: number | null;
  pierna?: number | null;
  pecho?: number | null;
  registrado_por?: string | null;
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface FichaDeportistaResponse {
  deportista: DeportistaResponse;
  membresia_actual?: MembresiaFichaResponse | null;
  ultimos_pagos: PagoFichaResponse[];
  ultimos_accesos: AccesoFichaResponse[];
  mediciones_recientes: MedicionCorporalResponse[];
  huellas_enroladas: HuellaInfoResponse[];
  cuenta_app: {
    id?: string | null;
    correo?: string | null;
    activa: boolean;
  };
}

export interface RegistrarMedicionRequest {
  fecha?: string;
  peso?: number;
  grasa_pct?: number;
  masa_muscular?: number;
  cintura?: number;
  cadera?: number;
  brazo?: number;
  pierna?: number;
  pecho?: number;
}

export interface EnrolarHuellaRequest {
  dedo: string;
  template_base64: string;
}
