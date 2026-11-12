"""GymDesk Escritorio: administración de estaciones (Jefe) y sincronización (estación)."""
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_role
from app.modules.sync.activacion import ActivacionService
from app.modules.sync.dependencias import EstacionOperativa
from app.modules.sync.estaciones import EstacionesService
from app.modules.sync.pull import LIMITE_MAXIMO, LIMITE_POR_DEFECTO, PullService
from app.modules.sync.schemas import (
    ActivarEstacionRequest,
    CrearEstacionRequest,
    EstacionActivadaDto,
    EstacionConCodigoDto,
    EstacionDto,
    PullResponse,
    RevocarEstacionRequest,
    SesionStaffRequest,
    SesionStaffResponse,
)

Sesion = Annotated[AsyncSession, Depends(get_db_session)]
Jefe = Annotated[AuthenticatedStaff, Depends(require_role("jefe"))]

estaciones_router = APIRouter(prefix="/estaciones", tags=["16. Estaciones de escritorio"])


@estaciones_router.get("", response_model=List[EstacionDto], summary="Estaciones de GymDesk Escritorio del gimnasio")
async def listar_estaciones(jefe: Jefe, session: Sesion):
    return await EstacionesService.listar(session, jefe.gimnasio_id)


@estaciones_router.post(
    "", response_model=EstacionConCodigoDto, status_code=status.HTTP_201_CREATED,
    summary="Crear una estación. El código de activación se muestra una sola vez",
)
async def crear_estacion(data: CrearEstacionRequest, jefe: Jefe, session: Sesion):
    return await EstacionesService.crear(session, jefe.gimnasio_id, jefe.id, jefe.nombre, data.nombre)


@estaciones_router.post(
    "/{estacion_id}/codigo", response_model=EstacionConCodigoDto,
    summary="Generar un código nuevo para una estación que aún no se activó",
)
async def regenerar_codigo(estacion_id: Annotated[UUID, Path()], jefe: Jefe, session: Sesion):
    return await EstacionesService.regenerar_codigo(session, jefe.gimnasio_id, estacion_id, jefe.id, jefe.nombre)


@estaciones_router.post("/{estacion_id}/revocar", response_model=EstacionDto, summary="Revocar una estación: deja de sincronizar")
async def revocar_estacion(estacion_id: Annotated[UUID, Path()], data: RevocarEstacionRequest, jefe: Jefe, session: Sesion):
    return await EstacionesService.revocar(session, jefe.gimnasio_id, estacion_id, jefe.id, jefe.nombre, data.motivo)


# =============================================================================
# Sincronización: la llama la estación, con su device_token
# =============================================================================
sync_router = APIRouter(prefix="/sync", tags=["17. Sincronización de escritorio"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@sync_router.post(
    "/activar", response_model=EstacionActivadaDto,
    summary="Activar una estación con el subdominio y el código que generó el Jefe (público)",
)
async def activar_estacion(data: ActivarEstacionRequest, request: Request, session: Sesion):
    return await ActivacionService.activar(session, data, _ip(request))


@sync_router.post(
    "/sesion-staff", response_model=SesionStaffResponse,
    summary="Primer ingreso de una persona en la estación: valida su contraseña en el servidor",
)
async def sesion_staff(data: SesionStaffRequest, request: Request, estacion: EstacionOperativa, session: Sesion):
    return await ActivacionService.sesion_staff(session, estacion, data, _ip(request))


@sync_router.get(
    "/pull", response_model=PullResponse,
    summary="Descarga paginada de lo que cambió desde el cursor. Sin cursor, la descarga inicial",
)
async def pull(
    estacion: EstacionOperativa,
    session: Sesion,
    cursor: Optional[str] = Query(None, max_length=600),
    limite: int = Query(LIMITE_POR_DEFECTO, ge=1, le=LIMITE_MAXIMO),
    version_app: Annotated[Optional[str], Header(alias="X-GymDesk-Version", max_length=20)] = None,
):
    return await PullService.pull(session, estacion, cursor, limite, version_app)
