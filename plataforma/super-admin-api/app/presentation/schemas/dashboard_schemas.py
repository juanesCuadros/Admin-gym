from typing import Dict
from pydantic import BaseModel

class DashboardMetricsResponse(BaseModel):
    total_gimnasios: int
    por_estado: Dict[str, int]
    vencidos: int
    por_vencer: int
    pruebas_por_vencer: int
    # Contrato 3.3: calculados desde platform.estado_suscripcion()
    en_gracia: int = 0
    bloqueados: int = 0
    listos_para_eliminar: int = 0
    solicitudes_plan_pendientes: int = 0
    pruebas_nuevas_7d: int = 0
    ingresos_mes: float
    mrr_estimado: float
    total_miembros_global: int
