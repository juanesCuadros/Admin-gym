from typing import Dict
from pydantic import BaseModel

class DashboardMetricsResponse(BaseModel):
    total_gimnasios: int
    por_estado: Dict[str, int]
    vencidos: int
    por_vencer: int
    pruebas_por_vencer: int
    ingresos_mes: float
    mrr_estimado: float
    total_miembros_global: int
