export interface DashboardMetrics {
  total_gimnasios: number;
  por_estado: Record<string, number>;
  vencidos: number;
  por_vencer: number;
  pruebas_por_vencer: number;
  ingresos_mes: number;
  mrr_estimado: number;
  total_miembros_global: number;
}
