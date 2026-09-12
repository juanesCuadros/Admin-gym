from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, get_current_staff, require_permission
from app.modules.clases.schemas import (
    AsistenciaResponse,
    CalificacionResponse,
    ClaseResponse,
    ClasesPaginadasResponse,
    CrearCalificacionRequest,
    CrearReservaRequest,
    EditarClaseRequest,
    ProgramarClaseRequest,
    RegistrarAsistenciaRequest,
    ReservaResponse,
    ResumenAsistenciaClaseResponse,
    ResumenCalificacionesResponse,
)
from app.modules.clases.service import ClasesService

router = APIRouter(prefix="/clases", tags=["07. Clases y Reservas"])


# =============================================================================
# 1. PROGRAMACIÓN Y GESTIÓN DE CLASES (RF-32)
# =============================================================================

@router.post(
    "",
    response_model=ClaseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Programa una clase única o serie recurrente con omisión de festivos",
    dependencies=[Depends(require_permission("clases", "crear"))],
)
async def programar_clase(
    req: ProgramarClaseRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.programar_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        req=req,
    )


@router.get(
    "",
    response_model=ClasesPaginadasResponse,
    summary="Agenda/calendario de clases del gimnasio con filtros de fecha y estado",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def listar_clases(
    desde: Optional[datetime] = Query(None, description="Fecha/hora inicio del filtro"),
    hasta: Optional[datetime] = Query(None, description="Fecha/hora fin del filtro"),
    entrenador_id: Optional[UUID] = Query(None, description="Filtrar por entrenador asignado"),
    tipo: Optional[str] = Query(None, description="Filtrar por tipo/disciplina"),
    estado: Optional[str] = Query(None, description="Filtrar por estado (programada, cancelada, realizada)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)] = None,
    session: Annotated[AsyncSession, Depends(get_db_session)] = None,
):
    return await ClasesService.listar_clases(
        session=session,
        gym_id=current_staff.gimnasio_id,
        desde=desde,
        hasta=hasta,
        entrenador_id=entrenador_id,
        tipo=tipo,
        estado=estado,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/{id}",
    response_model=ClaseResponse,
    summary="Detalle de una clase con cupos totales y disponibles",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def obtener_clase(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.obtener_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )


@router.put(
    "/{id}",
    response_model=ClaseResponse,
    summary="Edita los datos de una clase programada (profesor, cupo, fecha)",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def editar_clase(
    id: UUID,
    req: EditarClaseRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.editar_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        clase_id=id,
        req=req,
    )


@router.patch(
    "/{id}/cancelar",
    response_model=ClaseResponse,
    summary="Cancela una clase programada y libera los pases de sus reservas",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def cancelar_clase(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.cancelar_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        clase_id=id,
    )


# =============================================================================
# 2. RESERVAS DE CUPOS (RF-33)
# =============================================================================

@router.post(
    "/{id}/reservas",
    response_model=ReservaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reserva cupo para un deportista (valida membresía activa o pase de clase en caja)",
    dependencies=[Depends(require_permission("clases", "crear"))],
)
async def crear_reserva(
    id: UUID,
    req: CrearReservaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.crear_reserva(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        clase_id=id,
        req=req,
    )


@router.get(
    "/{id}/reservas",
    response_model=List[ReservaResponse],
    summary="Lista las reservas de una clase con su estado",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def listar_reservas_clase(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.listar_reservas_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )


@router.delete(
    "/{clase_id}/reservas/{reserva_id}",
    response_model=ReservaResponse,
    summary="Cancela una reserva y libera el cupo (y el pase si era de pago)",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def cancelar_reserva(
    clase_id: UUID,
    reserva_id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.cancelar_reserva(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        clase_id=clase_id,
        reserva_id=reserva_id,
    )


# =============================================================================
# 3. ASISTENCIA Y CIERRE DE CLASE (RF-34)
# =============================================================================

@router.post(
    "/{id}/asistencia",
    response_model=AsistenciaResponse,
    summary="Registra asistencia exigiendo check-in de torniquete del mismo día",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def registrar_asistencia(
    id: UUID,
    req: RegistrarAsistenciaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.registrar_asistencia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        clase_id=id,
        req=req,
    )


@router.get(
    "/{id}/asistencia",
    response_model=ResumenAsistenciaClaseResponse,
    summary="Lista los asistentes confirmados y los ausentes de la clase",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def obtener_resumen_asistencia(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.obtener_resumen_asistencia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )


@router.post(
    "/{id}/cerrar",
    response_model=ClaseResponse,
    summary="Cierra la clase realizada y marca las ausencias pendientes como no_show",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def cerrar_clase(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.cerrar_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        clase_id=id,
    )


# =============================================================================
# 4. CALIFICACIONES DE CLASE (RF-35)
# =============================================================================

@router.post(
    "/{id}/calificaciones",
    response_model=CalificacionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registra calificación (1-5) de un deportista que asistió a la clase",
    dependencies=[Depends(require_permission("clases", "crear"))],
)
async def calificar_clase(
    id: UUID,
    req: CrearCalificacionRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.calificar_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
        req=req,
    )


@router.get(
    "/{id}/calificaciones",
    response_model=ResumenCalificacionesResponse,
    summary="Consulta las calificaciones y promedio de satisfacción de la clase",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def obtener_calificaciones_clase(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await ClasesService.obtener_calificaciones_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )
