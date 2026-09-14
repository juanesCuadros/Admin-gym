export interface AuditLog {
  id: number;
  gimnasio_id?: string | null;
  actor_id?: string | null;
  actor_nombre: string;
  impersonando: boolean;
  accion: string;
  entidad: string;
  entidad_id?: string | null;
  detalle?: string | null;
  hash_previo?: string | null;
  hash_actual: string;
  created_at: string;
}

export interface AuditChainVerification {
  cadena_integra: boolean;
  total_registros_verificados: number;
  primer_registro_corrupto_id?: number | null;
  mensaje: string;
}
