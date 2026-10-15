import type { EstadoDeportista } from '../utils/estadoDeportista';

export interface CheckinManualRequest {
  deportista_id?: string;
  documento?: string;
}

export interface CheckinHuellaRequest {
  deportista_id: string;
}

export interface IngresoCortesiaRequest {
  motivo: string;
}

export interface DeportistaCheckinDto {
  id: string;
  documento: string;
  nombre: string;
  /** Contrato 2.1: enum consolidado del deportista. */
  estado: EstadoDeportista;
  dias_restantes_o_vencido: number;
}

export interface CheckinResponseDto {
  checkin_id?: number | null;
  tipo: 'ingreso' | 'cortesia';
  metodo: 'manual' | 'huella';
  /** Resultado del acceso. `alerta_mora` = pasó, pero con alerta de pago (nombre del backend). */
  resultado: 'abrio' | 'alerta_mora' | 'negado';
  comando_torniquete: boolean;
  mensaje: string;
  relectura_ignorada: boolean;
  deportista?: DeportistaCheckinDto | null;
  ts_local: string;
}

export interface CheckinItemHistorialDto {
  id: number;
  tipo: string;
  metodo: string;
  resultado: string;
  motivo_cortesia?: string | null;
  deportista_id?: string | null;
  deportista_nombre?: string | null;
  deportista_documento?: string | null;
  registrado_por_nombre?: string | null;
  ts_local: string;
  /** Contrato 2.2: instante de salida, si ya salió. */
  salida_ts?: string | null;
  /** Contrato 2.2: minutos entre ingreso y salida, si ya salió. */
  permanencia_minutos?: number | null;
}

export interface ResumenIngresosHoyDto {
  fecha: string;
  total_ingresos: number;
  accesos_abiertos: number;
  alertas_mora: number;
  accesos_negados: number;
  cortesias: number;
  /** Contrato 2.2: ingresos abiertos (sin salida) del día. */
  adentro_ahora: number;
}

export interface ListadoIngresosHoyResponse {
  resumen: ResumenIngresosHoyDto;
  items: CheckinItemHistorialDto[];
}

/** Contrato 2.2 · `POST /control-ingreso/salida`. */
export interface SalidaRequest {
  deportista_id: string;
}

export interface SalidaResponseDto {
  checkin_id: number;
  deportista_id: string;
  deportista_nombre: string;
  ingreso_ts: string;
  salida_ts: string;
  permanencia_minutos: number;
}

/** Contrato 2.2 · fila de `GET /control-ingreso/adentro`. */
export interface DeportistaAdentroItemDto {
  checkin_id: number;
  deportista_id: string;
  nombre: string;
  documento: string;
  ingreso_ts: string;
  minutos_adentro: number;
}

export interface DeportistasAdentroResponse {
  total: number;
  items: DeportistaAdentroItemDto[];
}
