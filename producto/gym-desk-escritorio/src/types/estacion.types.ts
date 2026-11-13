export interface ErrorSync {
  codigo: string;
  mensaje: string;
}

export interface EstadoSuscripcion {
  estado: 'al_dia' | 'por_vencer' | 'en_gracia' | 'bloqueado';
  /** Días que faltan para el corte; negativo si ya pasó. */
  dias_restantes: number | null;
  motivo_bloqueo: 'falta_pago' | 'prueba_vencida' | 'suspendido' | 'cancelado' | string | null;
  /** AAAA-MM-DD */
  fecha_corte: string | null;
}

export interface ConteosLocales {
  personal: number;
  deportistas: number;
  membresias: number;
  planes: number;
  productos: number;
}

export interface ConteosCola {
  /** Pendientes de subir al servidor. */
  por_enviar: number;
  con_error: number;
  por_revisar: number;
  aplicadas: number;
}

export interface EstadoEstacion {
  activada: boolean;
  revocada: boolean;
  estacion_id: string;
  estacion_nombre: string | null;
  gimnasio_nombre: string | null;
  subdominio: string | null;
  version_app: string;
  descarga_inicial_completa: boolean;
  /** Instante ISO-8601 en UTC. */
  ultima_descarga_ok: string | null;
  conteos: ConteosLocales;
  cola: ConteosCola;
  suscripcion: EstadoSuscripcion;
  sincronizando: boolean;
  en_linea: boolean;
  error_sync: ErrorSync | null;
}

export type EstadoOperacion = 'pendiente' | 'enviando' | 'aplicada' | 'pendiente_revision' | 'error' | 'retenida';

export interface ItemCola {
  id: string;
  tipo: string;
  accion: string | null;
  staff_nombre: string | null;
  /** Instante ISO-8601 en UTC. */
  ocurrida_en: string;
  estado: EstadoOperacion;
  intentos: number;
  codigo: string | null;
  mensaje: string | null;
}

export interface PaginaCola {
  items: ItemCola[];
  total: number;
}
