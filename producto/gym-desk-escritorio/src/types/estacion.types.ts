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
  suscripcion: EstadoSuscripcion;
  sincronizando: boolean;
  en_linea: boolean;
  error_sync: ErrorSync | null;
}
