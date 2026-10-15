import type { EstadoDeportista } from '../utils/estadoDeportista';

/** Contrato 2.3: tipos de documento admitidos. */
export const TIPOS_DOCUMENTO = ['CC', 'TI', 'CE', 'PAS', 'PPT', 'RC'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const NOMBRE_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  CC: 'Cédula de ciudadanía',
  TI: 'Tarjeta de identidad',
  CE: 'Cédula de extranjería',
  PAS: 'Pasaporte',
  PPT: 'Permiso por protección temporal',
  RC: 'Registro civil',
};

/** Contrato 2.3: obligatorio si el deportista es menor de 18 años (hora Bogotá). */
export interface AcudienteDto {
  nombre: string;
  tipo_documento: TipoDocumento;
  documento: string;
  telefono: string;
  parentesco: string;
  autoriza: boolean;
}

export interface CrearDeportistaRequest {
  /** Contrato 2.3: obligatorio al crear. */
  tipo_documento: TipoDocumento;
  documento: string;
  nombre: string;
  correo?: string;
  telefono?: string;
  sexo?: 'M' | 'F' | 'otro';
  fecha_nacimiento?: string;
  altura_cm?: number;
  consentimiento_1581: boolean;
  /** Versión del texto de consentimiento aceptado (el backend asume "1.0"). */
  consentimiento_version?: string;
  acudiente?: AcudienteDto;
}

export interface EditarDeportistaRequest {
  version: number;
  tipo_documento?: TipoDocumento;
  documento?: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
  sexo?: 'M' | 'F' | 'otro';
  fecha_nacimiento?: string;
  altura_cm?: number;
  acudiente?: AcudienteDto;
}

/** `409 LIMITE_PLAN_CLIENTES` (contrato 2.3). */
export interface DetallesLimitePlanClientes {
  limite: number;
  actuales: number;
  plan_nombre: string;
}

export interface DeportistaResumenResponse {
  id: string;
  tipo_documento?: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  activo: boolean;
  /** Contrato 2.1: enum consolidado del deportista. */
  estado: EstadoDeportista;
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
  tipo_documento: string;
  documento: string;
  nombre: string;
  correo?: string | null;
  telefono?: string | null;
  sexo?: string | null;
  fecha_nacimiento?: string | null;
  altura_cm?: number | null;
  consentimiento_1581: boolean;
  consentimiento_fecha?: string | null;
  /** Contrato 2.3. */
  consentimiento_version?: string | null;
  consentimiento_registrado_por_nombre?: string | null;
  acudiente?: AcudienteDto | null;
  acudiente_nombre?: string | null;
  activo: boolean;
  /** Contrato 2.1: viene en la ficha (`GET /deportistas/{id}`); `null` en las respuestas de crear y editar. */
  estado?: EstadoDeportista | null;
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
  estado: EstadoDeportista;
  /** Contrato 1.3: la membresía pertenece a un plan grupal. */
  paquete_id?: string | null;
  titular_nombre?: string | null;
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
