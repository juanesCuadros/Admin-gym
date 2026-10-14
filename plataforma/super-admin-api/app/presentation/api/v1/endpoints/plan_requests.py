from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.application.use_cases.plan_request_use_cases import PlanRequestUseCases
from app.core.dependencies import get_current_admin_user
from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import SolicitudPlan, UsuarioInterno
from app.presentation.schemas.plan_request_schemas import (
    AprobacionResponse, AprobarSolicitudRequest, GimnasioResumen, PlanResumen,
    RechazarSolicitudRequest, SolicitudPlanResponse
)

router = APIRouter(prefix="/admin/plan-requests", tags=["Planes de suscripción"])


def _a_respuesta(s: SolicitudPlan) -> SolicitudPlanResponse:
    return SolicitudPlanResponse(
        id=s.id,
        gimnasio=GimnasioResumen(id=s.gimnasio.id, nombre=s.gimnasio.nombre, subdominio=s.gimnasio.subdominio),
        plan=PlanResumen(id=s.plan.id, nombre=s.plan.nombre, precio=int(s.plan.precio or 0),
                         duracion_meses=s.plan.duracion_meses),
        solicitado_por=s.solicitado_por, nota=s.nota, created_at=s.created_at, estado=s.estado,
        motivo_rechazo=s.motivo_rechazo, resuelta_en=s.resuelta_en,
    )


@router.get("", response_model=List[SolicitudPlanResponse], summary="Listar solicitudes de plan")
def listar_solicitudes(
    estado: Optional[str] = Query(None, pattern="^(pendiente|aprobada|rechazada|cancelada)$"),
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user),
):
    return [_a_respuesta(s) for s in PlanRequestUseCases(db).listar(estado)]


@router.post("/{solicitud_id}/approve", response_model=AprobacionResponse, summary="Aprobar solicitud con su pago")
def aprobar_solicitud(
    solicitud_id: str,
    data: AprobarSolicitudRequest,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=10, max_length=100),
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user),
):
    """Registra el pago (meses = duración del plan), crea la suscripción con el plan y recalcula el corte,
    todo en una transacción. Un reintento con la misma Idempotency-Key devuelve el mismo resultado."""
    return PlanRequestUseCases(db).aprobar(solicitud_id, idempotency_key, data, current_user)


@router.post("/{solicitud_id}/reject", response_model=SolicitudPlanResponse, summary="Rechazar solicitud")
def rechazar_solicitud(
    solicitud_id: str,
    data: RechazarSolicitudRequest,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user),
):
    return _a_respuesta(PlanRequestUseCases(db).rechazar(solicitud_id, data.motivo, current_user))
