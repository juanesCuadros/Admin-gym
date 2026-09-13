"""Router para el módulo personal y staff (RF-39, RF-40)"""
from typing import Annotated, Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, get_current_staff, require_permission, require_role
from app.modules.personal.schemas import (
    ActualizarStaffRequest,
    CambiarEstadoStaffRequest,
    CambiarEstadoStaffResponse,
    CrearStaffRequest,
    StaffListResponse,
    StaffResponse,
    TransferirJefeRequest,
    TransferirJefeResponse,
)
from app.modules.personal.service import PersonalService

router = APIRouter(prefix="/personal", tags=["09. Personal y Staff"])


@router.get("/status", summary="Estado del módulo personal")
async def get_status():
    """Retorna el estado de disponibilidad del módulo de Personal y Staff."""
    return {"modulo": "personal", "estado": "activo"}


@router.get(
    "",
    response_model=StaffListResponse,
    summary="Listar miembros del personal",
    description="Obtiene un listado paginado del personal del gimnasio con soporte para filtros por texto, rol y estado activo.",
)
async def listar_personal(
    buscar: Optional[str] = Query(None, description="Término de búsqueda por nombre o correo"),
    rol: Optional[str] = Query(None, description="Filtrar por rol: recepcionista, entrenador, jefe"),
    activo: Optional[bool] = Query(None, description="Filtrar por estado activo"),
    pagina: int = Query(1, ge=1, description="Número de página"),
    limite: int = Query(20, ge=1, le=100, description="Cantidad de registros por página"),
    current_staff: AuthenticatedStaff = Depends(require_permission("personal", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.listar_staff(
        session=session,
        gym_id=current_staff.gimnasio_id,
        buscar=buscar,
        rol=rol,
        activo=activo,
        pagina=pagina,
        limite=limite,
    )


@router.post(
    "",
    response_model=StaffResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear miembro del personal (RF-39)",
    description="Registra un nuevo recepcionista o entrenador con contraseña hasheada en Argon2id y validación de correo único.",
)
async def crear_personal(
    data: CrearStaffRequest,
    current_staff: AuthenticatedStaff = Depends(require_permission("personal", "crear")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.crear_staff(
        session=session,
        gym_id=current_staff.gimnasio_id,
        data=data,
        actor=current_staff,
    )


@router.post(
    "/transferir-jefe",
    response_model=TransferirJefeResponse,
    summary="Transferir el rol de Jefe (RF-40)",
    description="Transfiere el rol de Jefe a otro miembro activo del gimnasio. Requiere confirmación con contraseña del Jefe actual y respeta el índice único de Jefe por gimnasio.",
)
async def transferir_jefe(
    data: TransferirJefeRequest,
    current_staff: AuthenticatedStaff = Depends(require_role("jefe")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.transferir_jefe(
        session=session,
        gym_id=current_staff.gimnasio_id,
        data=data,
        actor=current_staff,
    )


@router.get(
    "/{id}",
    response_model=StaffResponse,
    summary="Obtener detalle de un miembro del personal",
    description="Devuelve la información de un miembro del personal perteneciente al gimnasio.",
)
async def obtener_personal(
    id: UUID,
    current_staff: AuthenticatedStaff = Depends(require_permission("personal", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.obtener_staff(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=id,
    )


@router.put(
    "/{id}",
    response_model=StaffResponse,
    summary="Actualizar miembro del personal",
    description="Actualiza nombre, correo y rol operativo de un miembro del staff con control de concurrencia optimista (version).",
)
async def actualizar_personal(
    id: UUID,
    data: ActualizarStaffRequest,
    current_staff: AuthenticatedStaff = Depends(require_permission("personal", "editar")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.actualizar_staff(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=id,
        data=data,
        actor=current_staff,
    )


@router.patch(
    "/{id}/estado",
    response_model=CambiarEstadoStaffResponse,
    summary="Activar o desactivar miembro del personal (RF-39)",
    description="Cambia el estado activo del personal. Si se desactiva a un recepcionista con turno de caja abierto, se ejecuta el cierre forzado de turno automáticamente.",
)
async def cambiar_estado_personal(
    id: UUID,
    data: CambiarEstadoStaffRequest,
    current_staff: AuthenticatedStaff = Depends(require_permission("personal", "editar")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.cambiar_estado(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=id,
        data=data,
        actor=current_staff,
    )


@router.delete(
    "/{id}",
    response_model=Dict[str, Any],
    summary="Eliminar lógicamente un miembro del personal",
    description="Realiza la eliminación lógica (soft-delete) del miembro del personal y revoca sus sesiones activas. Si tiene turnos de caja abiertos, se cierran forzadamente.",
)
async def eliminar_personal(
    id: UUID,
    current_staff: AuthenticatedStaff = Depends(require_permission("personal", "eliminar")),
    session: AsyncSession = Depends(get_db_session),
):
    return await PersonalService.eliminar_staff(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=id,
        actor=current_staff,
    )
