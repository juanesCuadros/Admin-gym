import type { EstadoOperacion } from './estacion.types';

/** Mismo enum del deportista que usa la web (§A4). */
export type EstadoCliente =
  | 'desactivado'
  | 'cancelado'
  | 'sin_membresia'
  | 'congelado'
  | 'vencido'
  | 'en_gracia'
  | 'por_vencer'
  | 'activo';

export type ResultadoAcceso = 'abrio' | 'alerta_mora' | 'negado';

export interface ClienteEvaluado {
  id: string;
  nombre: string;
  tipo_documento: string | null;
  documento: string;
  plan_nombre: string | null;
  /** AAAA-MM-DD */
  fecha_vencimiento: string | null;
  estado: EstadoCliente;
  /** Días que faltan si está vigente; días vencidos si está en gracia o vencido. */
  dias_restantes_o_vencido: number;
  con_pase_dia: boolean;
  abre: boolean;
  resultado: ResultadoAcceso;
  mensaje: string;
  /** Foto tomada en esta estación (data URL), si la hay. */
  foto: string | null;
}

/** Datos para registrar un cliente: los mismos que pide la web (Ley 1581, menor con acudiente). */
export interface NuevoCliente {
  tipo_documento: 'CC' | 'TI' | 'CE' | 'PAS' | 'PPT' | 'RC';
  documento: string;
  nombre: string;
  telefono?: string;
  correo?: string;
  sexo?: 'M' | 'F' | 'otro';
  fecha_nacimiento?: string;
  consentimiento_1581: true;
  acudiente?: {
    nombre: string;
    tipo_documento: 'CC' | 'TI' | 'CE' | 'PAS' | 'PPT' | 'RC';
    documento: string;
    telefono: string;
    parentesco: string;
    autoriza: boolean;
  };
}

export interface ResultadoIngreso {
  /** `null` si fue una relectura ignorada (misma persona en menos de 3 segundos). */
  id: string | null;
  tipo: 'ingreso' | 'cortesia';
  relectura_ignorada: boolean;
  abre: boolean;
  resultado: ResultadoAcceso;
  mensaje: string;
  cliente: ClienteEvaluado | null;
  /** Instante ISO-8601 en UTC. */
  ocurrido_en: string;
}

export interface IngresoListado {
  id: string;
  tipo: 'ingreso' | 'cortesia';
  deportista_nombre: string | null;
  resultado: ResultadoAcceso;
  estado: EstadoCliente | null;
  mensaje: string;
  motivo_cortesia: string | null;
  ocurrido_en: string;
  /** Estado de su envío al servidor. */
  envio: EstadoOperacion;
}

export interface ResumenIngresos {
  /** AAAA-MM-DD (día de Bogotá) */
  fecha: string;
  total: number;
  abrieron: number;
  alertas: number;
  negados: number;
  cortesias: number;
  items: IngresoListado[];
  reloj_retrocedio: boolean;
}
