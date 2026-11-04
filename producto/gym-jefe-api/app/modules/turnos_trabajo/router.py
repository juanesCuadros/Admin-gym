"""Turno de trabajo. Cualquier persona marca el suyo; ver a los demás exige el permiso de Personal."""
from datetime import date
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, get_current_staff, require_permission, require_role
from app.modules.turnos_trabajo.schemas import (
    CerrarTurnoAjenoRequest,
    ListadoTurnosTrabajoResponse,
    MiTurnoResponse,
    TurnoTrabajoItem,
)
from app.modules.turnos_trabajo.service import TurnosTrabajoService

router = APIRouter(prefix="/turnos-trabajo", tags=["15. Turnos de trabajo"])

Sesion = Annotated[AsyncSession, Depends(get_db_session)]
Yo = Annotated[AuthenticatedStaff, Depends(get_current_staff)]


@router.get("/mio", response_model=MiTurnoResponse, summary="Mi turno abierto y lo trabajado hoy")
async def mi_turno(current_staff: Yo, session: Sesion):
    return await TurnosTrabajoService.mi_turno(session, current_staff.gimnasio_id, current_staff.id)


@router.post("/entrada", response_model=TurnoTrabajoItem, status_code=status.HTTP_201_CREATED, summary="Registrar mi entrada")
async def registrar_entrada(current_staff: Yo, session: Sesion):
    return await TurnosTrabajoService.registrar_entrada(session, current_staff.gimnasio_id, current_staff.id, current_staff.nombre)


@router.post("/salida", response_model=TurnoTrabajoItem, summary="Registrar mi salida")
async def registrar_salida(current_staff: Yo, session: Sesion):
    return await TurnosTrabajoService.registrar_salida(session, current_staff.gimnasio_id, current_staff.id, current_staff.nombre)


@router.get("", response_model=ListadoTurnosTrabajoResponse, summary="Turnos y horas del personal")
async def listar(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("personal", "leer"))],
    session: Sesion,
    desde: date = Query(...),
    hasta: date = Query(...),
    staff_id: Optional[UUID] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return await TurnosTrabajoService.listar(session, current_staff.gimnasio_id, desde, hasta, staff_id, limit, offset)


@router.post("/{turno_id}/cerrar", response_model=TurnoTrabajoItem, summary="El Jefe cierra un turno que quedó abierto")
async def cerrar_ajeno(
    turno_id: Annotated[UUID, Path()],
    data: CerrarTurnoAjenoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    session: Sesion,
):
    return await TurnosTrabajoService.cerrar_ajeno(
        session, current_staff.gimnasio_id, current_staff.id, current_staff.nombre, turno_id, data
    )
