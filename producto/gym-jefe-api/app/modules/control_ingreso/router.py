from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import (
    AuthenticatedStaff,
    get_db_session,
    require_permission,
)
from app.modules.control_ingreso.schemas import (
    CheckinHuellaRequest,
    CheckinManualRequest,
    CheckinResponseDto,
    DeportistaCheckinDto,
    IngresoCortesiaRequest,
    ListadoIngresosHoyResponse,
)
from app.modules.control_ingreso.service import ControlIngresoService

router = APIRouter(prefix="/control-ingreso", tags=["01. Control de Ingreso"])


@router.post(
    "/checkin-manual",
    response_model=CheckinResponseDto,
    summary="Registrar check-in manual por ID o documento (RF-01.1, RF-01.2)"
)
async def checkin_manual(
    data: CheckinManualRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("control_ingreso", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Registra el acceso manual de un deportista:
    - Valida deduplicación dentro de los últimos 3 segundos.
    - Calcula en tiempo real el estado dinámico (activo, mora, vencido, congelado, inactivo, sin_membresia).
    - Evalúa período de gracia para acceso con alerta de mora o rechazo estricto.
    - Registra el evento en platform.checkins.
    """
    return await ControlIngresoService.checkin_manual(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        data=data
    )


@router.post(
    "/checkin-huella",
    response_model=CheckinResponseDto,
    summary="Registrar check-in por huella dactilar (RF-01.1, RF-01.3)"
)
async def checkin_huella(
    data: CheckinHuellaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("control_ingreso", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Registra el acceso biométrico de un deportista una vez identificado el deportista_id:
    - Aplica deduplicación de 3 segundos ante dobles apoyos accidentales del dedo.
    - Evalúa estado dinámico de membresía y período de gracia.
    - Registra el evento con método 'huella' y emite comando para apertura del torniquete.
    """
    return await ControlIngresoService.evaluar_y_procesar_checkin(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        deportista_id=data.deportista_id,
        metodo="huella"
    )


@router.post(
    "/cortesia",
    response_model=CheckinResponseDto,
    summary="Registrar acceso de cortesía justificado (RF-01.4)"
)
async def registrar_cortesia(
    data: IngresoCortesiaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("control_ingreso", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Otorga un pase de cortesía sin requerir membresía previa:
    - Exige obligatoriamente un motivo justificado (mínimo 4 caracteres).
    - Abre el torniquete y guarda el evento en platform.checkins (deportista_id = NULL).
    - Genera un registro inmutable en auditoría (platform.auditoria_gym con hash-chain).
    """
    return await ControlIngresoService.registrar_cortesia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        data=data
    )


@router.get(
    "/ingresos-hoy",
    response_model=ListadoIngresosHoyResponse,
    summary="Listar ingresos del día actual y métricas de acceso (RF-01.5)"
)
async def obtener_ingresos_hoy(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("control_ingreso", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    limit: int = Query(50, ge=1, le=100, description="Cantidad máxima de registros a devolver"),
    offset: int = Query(0, ge=0, description="Desplazamiento para paginación")
):
    """
    Retorna el resumen de accesos del día local (total, abiertos, mora, negados, cortesías)
    y el historial paginado ordenado cronológicamente descendente.
    """
    return await ControlIngresoService.obtener_ingresos_hoy(
        session=session,
        gym_id=current_staff.gimnasio_id,
        limit=limit,
        offset=offset
    )


@router.get(
    "/evaluar-acceso/{deportista_id}",
    response_model=DeportistaCheckinDto,
    summary="Pre-evaluar estado de acceso de un deportista (RF-01.2)"
)
async def evaluar_acceso(
    deportista_id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("control_ingreso", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Permite a la recepción pre-visualizar el estado dinámico y días restantes o de mora
    de un deportista antes de registrar un checkin manual.
    """
    return await ControlIngresoService.pre_evaluar_acceso(
        session=session,
        gym_id=current_staff.gimnasio_id,
        deportista_id=deportista_id
    )
