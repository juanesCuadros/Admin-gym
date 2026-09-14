"""
Router de FastAPI para el Módulo 5: Membresías y Planes (RF-24 a RF-27, RF-42).
Expositor de endpoints REST protegidos por permisos granulares en PostgreSQL.
"""
from typing import Annotated, Any, Dict, List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_permission, require_role
from app.modules.membresias.schemas import (
    AsignarMembresiaRequest,
    CambiarEstadoPlanRequest,
    CambiarPlanRequest,
    CancelarMembresiaRequest,
    CongelarMembresiaRequest,
    CongelamientoItemResponse,
    CrearPlanRequest,
    EditarPlanRequest,
    FichaMembresiaResponse,
    MembresiaResponse,
    MembresiasPaginadasResponse,
    PlanResponse,
    PlanesListResponse,
)
from app.modules.membresias.service import MembresiasService

router = APIRouter(tags=["05. Membresías y Planes"])


# =============================================================================
# 1. CATÁLOGO DE PLANES TARIFARIOS (RF-24)
# =============================================================================

@router.post(
    "/planes",
    response_model=PlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear plan tarifario (RF-24)",
    description="Crea un nuevo plan tarifario configurable con nombre único en el gimnasio."
)
async def crear_plan(
    req: CrearPlanRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "crear"))],
):
    return await MembresiasService.crear_plan(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        req=req,
    )


@router.get(
    "/planes",
    response_model=PlanesListResponse,
    status_code=status.HTTP_200_OK,
    summary="Listar planes del gimnasio (RF-24)",
    description="Retorna la lista de planes tarifarios con opción de filtrar solo activos."
)
async def listar_planes(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "leer"))],
    solo_activos: Optional[bool] = Query(None, description="Filtrar únicamente planes activos para contratación"),
):
    return await MembresiasService.listar_planes(
        session=session,
        gym_id=staff.gimnasio_id,
        solo_activos=solo_activos,
    )


@router.get(
    "/planes/{id}",
    response_model=PlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Detalle de plan tarifario (RF-24)",
    description="Consulta la información detallada de un plan específico."
)
async def obtener_plan(
    id: Annotated[UUID, Path(description="UUID del plan a consultar")],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "leer"))],
):
    return await MembresiasService.obtener_plan(
        session=session,
        gym_id=staff.gimnasio_id,
        plan_id=id,
    )


@router.put(
    "/planes/{id}",
    response_model=PlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Editar plan con concurrencia optimista (RF-24)",
    description="Actualiza campos del plan verificando que la versión coincida con la última registrada."
)
async def editar_plan(
    id: Annotated[UUID, Path(description="UUID del plan a editar")],
    req: EditarPlanRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "editar"))],
):
    return await MembresiasService.editar_plan(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        plan_id=id,
        req=req,
    )


@router.patch(
    "/planes/{id}/estado",
    response_model=PlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Activar o desactivar plan (RF-24)",
    description="Modifica la disponibilidad de un plan. Un plan desactivado no afecta membresías existentes (no-retroactividad)."
)
async def cambiar_estado_plan(
    id: Annotated[UUID, Path(description="UUID del plan a modificar")],
    req: CambiarEstadoPlanRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "editar"))],
):
    return await MembresiasService.cambiar_estado_plan(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        plan_id=id,
        req=req,
    )


# =============================================================================
# 2. GESTIÓN DE MEMBRESÍAS Y CICLO DE VIDA (RF-25, RF-27, RF-42)
# =============================================================================

@router.post(
    "/membresias/asignar",
    response_model=MembresiaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Asignar plan inicial a deportista (RF-25)",
    description="Asigna el primer plan a un deportista. Valida que no exista ya una membresía activa."
)
async def asignar_plan(
    req: AsignarMembresiaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "crear"))],
):
    return await MembresiasService.asignar_plan(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        req=req,
    )


@router.get(
    "/membresias",
    response_model=MembresiasPaginadasResponse,
    status_code=status.HTTP_200_OK,
    summary="Listado paginado de membresías y reporte accionable (RF-27, RF-42)",
    description="Listado con cálculo derivado en memoria batch. Permite filtrar por estado (por_vencer, activo, mora, vencido)."
)
async def listar_membresias(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "leer"))],
    estado: Optional[str] = Query(None, description="Filtro por estado derivado: activo, por_vencer, mora, vencido, congelado, cancelada"),
    q: Optional[str] = Query(None, description="Búsqueda por cédula o nombre del deportista"),
    skip: int = Query(0, ge=0, description="Offset de paginación"),
    limit: int = Query(50, ge=1, le=100, description="Cantidad máxima de registros por página"),
):
    return await MembresiasService.listar_membresias(
        session=session,
        gym_id=staff.gimnasio_id,
        estado=estado,
        q=q,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/membresias/{id}",
    response_model=FichaMembresiaResponse,
    status_code=status.HTTP_200_OK,
    summary="Ficha detallada de membresía (RF-25, RF-26)",
    description="Detalle completo de la membresía con historial de congelamientos y pagos relacionados."
)
async def obtener_ficha_membresia(
    id: Annotated[UUID, Path(description="UUID de la membresía a consultar")],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "leer"))],
):
    return await MembresiasService.obtener_ficha_membresia(
        session=session,
        gym_id=staff.gimnasio_id,
        membresia_id=id,
    )


@router.get(
    "/membresias/deportista/{deportista_id}",
    response_model=List[MembresiaResponse],
    status_code=status.HTTP_200_OK,
    summary="Historial de membresías de un deportista (RF-25)",
    description="Retorna el histórico ordenado de todas las membresías contratadas por el deportista."
)
async def obtener_membresias_deportista(
    deportista_id: Annotated[UUID, Path(description="UUID del deportista")],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "leer"))],
):
    return await MembresiasService.obtener_membresias_deportista(
        session=session,
        gym_id=staff.gimnasio_id,
        deportista_id=deportista_id,
    )


@router.post(
    "/membresias/{id}/cambiar-plan",
    response_model=MembresiaResponse,
    status_code=status.HTTP_200_OK,
    summary="Cambiar de plan sin prorrateo (RF-25)",
    description="Sustitución inmediata: cancela la membresía anterior, cierra congelamientos y crea una nueva desde hoy."
)
async def cambiar_plan(
    id: Annotated[UUID, Path(description="UUID de la membresía actual")],
    req: CambiarPlanRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "editar"))],
):
    return await MembresiasService.cambiar_plan(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        membresia_id=id,
        req=req,
    )


@router.post(
    "/membresias/{id}/cancelar",
    response_model=Dict[str, Any],
    status_code=status.HTTP_200_OK,
    summary="Cancelar membresía (RF-25, RF-27)",
    description="Cancela voluntaria o disciplinariamente una membresía. Cierra congelamientos abiertos si existieran."
)
async def cancelar_membresia(
    id: Annotated[UUID, Path(description="UUID de la membresía a cancelar")],
    req: CancelarMembresiaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "eliminar"))],
):
    return await MembresiasService.cancelar_membresia(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        membresia_id=id,
        req=req,
    )


# =============================================================================
# 3. CONGELAMIENTO Y DESCONGELAMIENTO (RF-26)
# =============================================================================

@router.post(
    "/membresias/{id}/congelar",
    response_model=CongelamientoItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Congelar membresía temporalmente (RF-26)",
    description="Pausa la membresía desde hoy. Valida que no exceda el tope de días configurable del gimnasio."
)
async def congelar_membresia(
    id: Annotated[UUID, Path(description="UUID de la membresía a congelar")],
    req: CongelarMembresiaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "editar"))],
):
    return await MembresiasService.congelar_membresia(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        membresia_id=id,
        req=req,
    )


@router.post(
    "/membresias/{id}/descongelar",
    response_model=CongelamientoItemResponse,
    status_code=status.HTTP_200_OK,
    summary="Descongelar membresía y extender vigencia (RF-26)",
    description="Reanuda la membresía: cierra el congelamiento y extiende la fecha de vencimiento por los días efectivos."
)
async def descongelar_membresia(
    id: Annotated[UUID, Path(description="UUID de la membresía a descongelar")],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("membresias", "editar"))],
):
    return await MembresiasService.descongelar_membresia(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        membresia_id=id,
    )
