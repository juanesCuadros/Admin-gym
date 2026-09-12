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
  estado_calculado: 'activo' | 'por_vencer' | 'mora' | 'vencido' | 'congelado' | 'cancelada' | 'inactivo' | 'sin_membresia';
  dias_restantes_o_vencido: number;
}

export interface CheckinResponseDto {
  checkin_id?: number | null;
  tipo: 'ingreso' | 'cortesia';
  metodo: 'manual' | 'huella';
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
}

export interface ResumenIngresosHoyDto {
  fecha: string;
  total_ingresos: number;
  accesos_abiertos: number;
  alertas_mora: number;
  accesos_negados: number;
  cortesias: number;
}

export interface ListadoIngresosHoyResponse {
  resumen: ResumenIngresosHoyDto;
  items: CheckinItemHistorialDto[];
}
