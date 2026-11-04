"""Gastos y pago a entrenadores. Los pagos a entrenadores siempre los hace el Jefe."""
from datetime import date
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_permission, require_role
from app.modules.gastos.schemas import (
    BeneficiarioStaff,
    ConfigPagoEntrenadorRequest,
    GastoResponse,
    LiquidacionEntrenador,
    ListadoGastosResponse,
    PagoEntrenadorResponse,
    RegistrarGastoRequest,
    RegistrarPagoEntrenadorRequest,
    ReporteResultadoResponse,
)
from app.modules.gastos.service import GastosService

router = APIRouter(prefix="/gastos", tags=["14. Gastos y pago a entrenadores"])

Sesion = Annotated[AsyncSession, Depends(get_db_session)]
Jefe = Annotated[AuthenticatedStaff, Depends(require_role("jefe"))]


@router.get("", response_model=ListadoGastosResponse, summary="Gastos por rango de fechas")
async def listar_gastos(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("gastos", "leer"))],
    session: Sesion,
    desde: date = Query(...),
    hasta: date = Query(...),
    categoria: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return await GastosService.listar_gastos(session, current_staff.gimnasio_id, desde, hasta, categoria, limit, offset)


@router.post("", response_model=GastoResponse, status_code=status.HTTP_201_CREATED, summary="Registrar un gasto")
async def registrar_gasto(
    data: RegistrarGastoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("gastos", "crear"))],
    session: Sesion,
    x_idempotency_key: Annotated[str, Header(min_length=8, max_length=100)],
):
    return await GastosService.registrar_gasto(
        session, current_staff.gimnasio_id, current_staff.staff_id, current_staff.nombre, x_idempotency_key, data
    )


@router.get("/beneficiarios", response_model=List[BeneficiarioStaff], summary="Personal activo que puede recibir un gasto")
async def listar_beneficiarios(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("gastos", "crear"))],
    session: Sesion,
):
    return await GastosService.listar_beneficiarios(session, current_staff.gimnasio_id)


@router.get("/resultado", response_model=ReporteResultadoResponse, summary="Ingresos menos gastos del periodo")
async def reporte_resultado(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("gastos", "leer"))],
    session: Sesion,
    desde: date = Query(...),
    hasta: date = Query(...),
):
    return await GastosService.reporte_resultado(session, current_staff.gimnasio_id, desde, hasta)


@router.get("/entrenadores", response_model=List[LiquidacionEntrenador], summary="Cuánto se le debe a cada entrenador")
async def listar_liquidaciones(
    current_staff: Jefe,
    session: Sesion,
    desde: date = Query(...),
    hasta: date = Query(...),
):
    return await GastosService.listar_liquidaciones(session, current_staff.gimnasio_id, desde, hasta)


@router.put("/entrenadores/{staff_id}/config", response_model=LiquidacionEntrenador, summary="Configurar cómo se le paga")
async def configurar_pago(
    staff_id: Annotated[UUID, Path()],
    data: ConfigPagoEntrenadorRequest,
    current_staff: Jefe,
    session: Sesion,
):
    return await GastosService.configurar_pago(
        session, current_staff.gimnasio_id, current_staff.staff_id, current_staff.nombre, staff_id, data
    )


@router.post(
    "/entrenadores/{staff_id}/pagos",
    response_model=PagoEntrenadorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar el pago a un entrenador",
)
async def registrar_pago(
    staff_id: Annotated[UUID, Path()],
    data: RegistrarPagoEntrenadorRequest,
    current_staff: Jefe,
    session: Sesion,
    x_idempotency_key: Annotated[str, Header(min_length=8, max_length=100)],
):
    return await GastosService.registrar_pago(
        session, current_staff.gimnasio_id, current_staff.staff_id, current_staff.nombre, staff_id, x_idempotency_key, data
    )
