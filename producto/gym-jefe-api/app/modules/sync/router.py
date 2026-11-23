"""GymDesk Escritorio: administración de estaciones (Jefe) y sincronización (estación)."""
from typing import Annotated, List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Path, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_role
from app.modules.sync.activacion import ActivacionService
from app.modules.sync.dependencias import Estacion, EstacionOperativa
from app.modules.sync.estaciones import EstacionesService
from app.modules.sync.pull import LIMITE_MAXIMO, LIMITE_POR_DEFECTO, PullService
from app.modules.deportistas.schemas import MedicionCorporalResponse
from app.modules.sync import caja, clientes, huellas, ingresos, membresias
from app.modules.sync.push import MANEJADORES, PushService
from app.modules.sync.revisiones import ListadoRevisionesResponse, RevisarRequest, RevisionDto, RevisionesService
from app.modules.sync.schemas import (
    ActivarEstacionRequest,
    CrearEstacionRequest,
    EstacionActivadaDto,
    EstacionConCodigoDto,
    EstacionDto,
    PullResponse,
    PushRequest,
    PushResponse,
    RevocarEstacionRequest,
    SesionStaffRequest,
    SesionStaffResponse,
)

# Tipos de operación de la fase 2.
MANEJADORES.update({"ingreso": ingresos.ingreso, "cortesia": ingresos.cortesia})
# Tipos de la fase 3A: caja sin red.
MANEJADORES.update({
    "turno_abrir": caja.turno_abrir, "venta": caja.venta, "egreso": caja.egreso, "turno_cerrar": caja.turno_cerrar,
})
# Tipos de la fase 3B (parte 1): renovar y vender membresías sin red.
MANEJADORES.update({"membresia_renovar": membresias.renovar, "membresia_vender": membresias.vender})
# Fase 4: huellas registradas en la estación.
MANEJADORES.update({"huella_enrolar": huellas.enrolar})

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


@sync_router.get(
    "/caja/turno-abierto", response_model=caja.TurnoAbiertoDto,
    summary="Antes de abrir caja en la estación: ¿hay otro turno abierto en el gimnasio? (P-13 con red)",
)
async def turno_abierto(estacion: EstacionOperativa, session: Sesion):
    return await caja.turno_abierto(session, estacion)


@sync_router.post(
    "/clientes", response_model=clientes.ClienteRegistradoDto, status_code=status.HTTP_201_CREATED,
    summary="Registrar un cliente desde la estación, con foto opcional. Exige conexión (E-41)",
)
async def registrar_cliente(data: clientes.RegistrarClienteRequest, estacion: EstacionOperativa, session: Sesion):
    return await clientes.registrar(session, estacion, data)


@sync_router.get(
    "/clientes/{deportista_id}/mediciones", response_model=List[MedicionCorporalResponse],
    summary="Historial de mediciones de un cliente, desde la estación. Exige conexión",
)
async def mediciones_cliente(
    deportista_id: Annotated[UUID, Path()], estacion: EstacionOperativa, session: Sesion, staff_id: UUID = Query(...),
):
    return await clientes.mediciones(session, estacion, deportista_id, staff_id)


@sync_router.post(
    "/clientes/{deportista_id}/mediciones", response_model=MedicionCorporalResponse, status_code=status.HTTP_201_CREATED,
    summary="Registrar una medición desde la estación. Exige conexión",
)
async def registrar_medicion_cliente(
    deportista_id: Annotated[UUID, Path()], data: clientes.RegistrarMedicionEstacionRequest, estacion: EstacionOperativa, session: Sesion,
):
    return await clientes.registrar_medicion(session, estacion, deportista_id, data)


@sync_router.post(
    "/push", response_model=PushResponse,
    summary="Recibe lo que la estación hizo sin red. Se acepta aunque el gimnasio esté bloqueado",
)
async def push(data: PushRequest, estacion: Estacion, session: Sesion):
    return await PushService.push(session, estacion, data.operaciones, data.estacion_ahora)


# =============================================================================
# Por revisar: lo ve y lo cierra el Jefe, desde la web
# =============================================================================
@sync_router.get(
    "/revisiones", response_model=ListadoRevisionesResponse,
    summary="Lo que las estaciones registraron y quedó por revisar",
)
async def listar_revisiones(
    jefe: Jefe,
    session: Sesion,
    estado: Literal["pendiente_revision", "revisado", "todas"] = Query("pendiente_revision"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return await RevisionesService.listar(session, jefe.gimnasio_id, estado, limit, offset)


@sync_router.post(
    "/revisiones/{revision_id}/revisar", response_model=RevisionDto,
    summary="Cerrar una revisión con nota. Solo el Jefe, una sola vez",
)
async def revisar(revision_id: Annotated[UUID, Path()], data: RevisarRequest, jefe: Jefe, session: Sesion):
    return await RevisionesService.revisar(session, jefe.gimnasio_id, revision_id, jefe.id, jefe.nombre, data)
