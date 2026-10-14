from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.application.use_cases.plan_use_cases import PlanUseCases, plan_a_dict
from app.core.dependencies import get_current_admin_user
from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.presentation.schemas.plan_schemas import (
    CambioPlanRequest, CambioPlanResponse, PlanCreate, PlanResponse, PlanStatusUpdate, PlanUpdate
)

router = APIRouter(tags=["Planes de suscripción"])


@router.get("/admin/plans", response_model=List[PlanResponse], summary="Listar planes de suscripción")
def listar_planes(db: Session = Depends(get_db), current_user: UsuarioInterno = Depends(get_current_admin_user)):
    """SA-RF-33: catálogo completo con el número de gimnasios que tienen cada plan como vigente."""
    return [PlanResponse(**plan_a_dict(p), gimnasios_actuales=n) for p, n in PlanUseCases(db).listar()]


@router.post("/admin/plans", response_model=PlanResponse, status_code=status.HTTP_201_CREATED, summary="Crear plan")
def crear_plan(data: PlanCreate, db: Session = Depends(get_db), current_user: UsuarioInterno = Depends(get_current_admin_user)):
    """SA-RF-33: crea un plan. `409 CODIGO_DUPLICADO` si el código ya existe."""
    return PlanResponse(**plan_a_dict(PlanUseCases(db).crear(data, current_user)))


@router.put("/admin/plans/{plan_id}", response_model=PlanResponse, summary="Editar plan (con versión)")
def editar_plan(plan_id: str, data: PlanUpdate, db: Session = Depends(get_db),
                current_user: UsuarioInterno = Depends(get_current_admin_user)):
    """SA-RF-33: edita con concurrencia optimista (`version`). `codigo` y `tipo` no se editan."""
    return PlanResponse(**plan_a_dict(PlanUseCases(db).actualizar(plan_id, data, current_user)))


@router.patch("/admin/plans/{plan_id}/status", response_model=PlanResponse, summary="Activar o desactivar plan")
def estado_plan(plan_id: str, data: PlanStatusUpdate, db: Session = Depends(get_db),
                current_user: UsuarioInterno = Depends(get_current_admin_user)):
    return PlanResponse(**plan_a_dict(PlanUseCases(db).cambiar_estado(plan_id, data.activo, current_user)))


@router.patch("/admin/gyms/{gym_id}/plan", response_model=CambioPlanResponse, summary="Cambiar el plan de un gimnasio")
def cambiar_plan(gym_id: str, data: CambioPlanRequest, db: Session = Depends(get_db),
                 current_user: UsuarioInterno = Depends(get_current_admin_user)):
    """Contrato 3.1: cambio de plan manual por MVC. Crea un registro nuevo de suscripción (no retroactivo)."""
    gym, plan, sus = PlanUseCases(db).cambiar_plan_gimnasio(gym_id, data.plan_id, data.vigente_desde, current_user)
    return CambioPlanResponse(
        gimnasio_id=gym.id, plan_id=plan.id, plan_nombre=plan.nombre, suscripcion_id=sus.id,
        valor_mensual=int(sus.valor_mensual), vigente_desde=sus.vigente_desde,
    )
