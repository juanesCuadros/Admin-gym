from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.dependencies import get_current_admin_user
from app.infrastructure.repositories.gym_repository import GymRepository
from app.presentation.schemas.dashboard_schemas import DashboardMetricsResponse

router = APIRouter(prefix="/admin/dashboard", tags=["Dashboard / Inicio"])

@router.get("/metrics", response_model=DashboardMetricsResponse, summary="Obtener métricas globales de inicio")
def get_dashboard_metrics(
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-01: Pantalla de inicio con métricas básicas:
    - Gimnasios por estado
    - Vencidos y por vencer (en los próximos 5 días)
    - Pruebas por vencer
    - Ingresos por suscripción del mes
    - MRR estimado
    - Total de miembros
    """
    repo = GymRepository(db)
    metrics = repo.get_dashboard_metrics()
    return DashboardMetricsResponse(**metrics)
