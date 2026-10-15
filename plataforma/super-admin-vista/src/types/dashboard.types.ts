// Tipos escritos a mano desde plataforma/super-admin-api/app/presentation/schemas/dashboard_schemas.py
export interface DashboardMetrics {
  total_gimnasios: number;
  por_estado: Record<string, number>;
  /** Heredado: en gracia + bloqueados. */
  vencidos: number;
  por_vencer: number;
  pruebas_por_vencer: number;
  // Contrato 3.3: calculados desde platform.estado_suscripcion()
  en_gracia: number;
  bloqueados: number;
  listos_para_eliminar: number;
  solicitudes_plan_pendientes: number;
  pruebas_nuevas_7d: number;
  ingresos_mes: number;
  mrr_estimado: number;
  total_miembros_global: number;
}
