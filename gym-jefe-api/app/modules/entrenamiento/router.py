"""
Endpoints REST para el Módulo 6: Entrenamiento (RF-28 a RF-31).
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, get_current_staff, require_permission
from app.modules.entrenamiento.schemas import (
    AsignarRutinaRequest,
    CambiarEstadoEjercicioRequest,
    CambiarEstadoRutinaAsignadaRequest,
    CrearEjercicioPropioRequest,
    CrearPlantillaRequest,
    EditarEjercicioPropioRequest,
    EditarPlantillaRequest,
    EjercicioResponse,
    EjerciciosPaginadosResponse,
    PersonalizarRutinaAsignadaRequest,
    PlantillasPaginadasResponse,
    RutinaAsignadaResponse,
    RutinaPlantillaResponse,
)
from app.modules.entrenamiento.service import EntrenamientoService

router = APIRouter(prefix="/entrenamiento", tags=["06. Entrenamiento y Ejercicios"])


# =============================================================================
# 1. CATÁLOGO DE EJERCICIOS (RF-28)
# =============================================================================

@router.get(
    "/ejercicios",
    response_model=EjerciciosPaginadosResponse,
    summary="Catálogo de ejercicios con activación por sede y GIF condicional",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def listar_ejercicios(
    busqueda: Optional[str] = Query(None, description="Búsqueda por nombre español o inglés"),
    grupo_muscular: Optional[str] = Query(None, description="Filtro por grupo muscular"),
    categoria: Optional[str] = Query(None, description="Filtro por categoría"),
    equipo: Optional[str] = Query(None, description="Filtro por equipo"),
    solo_propios: bool = Query(False, description="Filtrar solo ejercicios propios del gimnasio"),
    solo_globales: bool = Query(False, description="Filtrar solo ejercicios globales"),
    solo_activos_sede: Optional[bool] = Query(None, description="Filtrar por estado activo en la sede"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.listar_ejercicios(
        session=session,
        gym_id=current_staff.gimnasio_id,
        busqueda=busqueda,
        grupo_muscular=grupo_muscular,
        categoria=categoria,
        equipo=equipo,
        solo_propios=solo_propios,
        solo_globales=solo_globales,
        solo_activos_sede=solo_activos_sede,
        skip=skip,
        limit=limit,
    )


@router.post(
    "/ejercicios",
    response_model=EjercicioResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crea un ejercicio propio del gimnasio",
    dependencies=[Depends(require_permission("entrenamiento", "crear"))],
)
async def crear_ejercicio_propio(
    req: CrearEjercicioPropioRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.crear_ejercicio_propio(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        req=req,
    )


@router.get(
    "/ejercicios/{id}",
    response_model=EjercicioResponse,
    summary="Detalle de un ejercicio del catálogo",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def obtener_ejercicio(
    id: UUID,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.obtener_ejercicio(
        session=session,
        gym_id=current_staff.gimnasio_id,
        ejercicio_id=id,
    )


@router.put(
    "/ejercicios/{id}",
    response_model=EjercicioResponse,
    summary="Edita un ejercicio propio del gimnasio con control optimista",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def editar_ejercicio_propio(
    id: UUID,
    req: EditarEjercicioPropioRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.editar_ejercicio_propio(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        ejercicio_id=id,
        req=req,
    )


@router.patch(
    "/ejercicios/{id}/estado",
    response_model=EjercicioResponse,
    summary="Activa o desactiva un ejercicio en la sede (global o propio)",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def cambiar_estado_ejercicio(
    id: UUID,
    req: CambiarEstadoEjercicioRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.cambiar_estado_ejercicio(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        ejercicio_id=id,
        req=req,
    )


# =============================================================================
# 2. PLANTILLAS DE RUTINA (RF-29)
# =============================================================================

@router.post(
    "/plantillas",
    response_model=RutinaPlantillaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crea una plantilla de rutina reutilizable con ejercicios ordenados",
    dependencies=[Depends(require_permission("entrenamiento", "crear"))],
)
async def crear_plantilla(
    req: CrearPlantillaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.crear_plantilla(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        req=req,
    )


@router.get(
    "/plantillas",
    response_model=PlantillasPaginadasResponse,
    summary="Listado paginado de plantillas de rutina del gimnasio",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def listar_plantillas(
    busqueda: Optional[str] = Query(None, description="Búsqueda por nombre o descripción"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.listar_plantillas(
        session=session,
        gym_id=current_staff.gimnasio_id,
        busqueda=busqueda,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/plantillas/{id}",
    response_model=RutinaPlantillaResponse,
    summary="Detalle completo de una plantilla con sus ejercicios y regla de GIF",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def obtener_plantilla(
    id: UUID,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.obtener_plantilla(
        session=session,
        gym_id=current_staff.gimnasio_id,
        plantilla_id=id,
    )


@router.put(
    "/plantillas/{id}",
    response_model=RutinaPlantillaResponse,
    summary="Actualiza una plantilla de rutina con control optimista (version)",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def editar_plantilla(
    id: UUID,
    req: EditarPlantillaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.editar_plantilla(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        plantilla_id=id,
        req=req,
    )


@router.delete(
    "/plantillas/{id}",
    summary="Elimina una plantilla (los snapshots ya asignados no se alteran)",
    dependencies=[Depends(require_permission("entrenamiento", "eliminar"))],
)
async def eliminar_plantilla(
    id: UUID,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.eliminar_plantilla(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        plantilla_id=id,
    )


# =============================================================================
# 3. RUTINAS ASIGNADAS (SNAPSHOT INMUTABLE - RF-30, RF-31)
# =============================================================================

@router.post(
    "/asignar-rutina",
    response_model=RutinaAsignadaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Asigna una rutina a un deportista generando un snapshot inmutable",
    dependencies=[Depends(require_permission("entrenamiento", "crear"))],
)
async def asignar_rutina(
    req: AsignarRutinaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.asignar_rutina(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        req=req,
    )


@router.get(
    "/deportistas/{deportista_id}/rutinas",
    response_model=List[RutinaAsignadaResponse],
    summary="Consulta qué rutinas tiene asignadas un deportista (RF-31)",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def listar_rutinas_deportista(
    deportista_id: UUID,
    solo_activas: bool = Query(False, description="Filtrar solo rutinas marcadas como activas"),
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.listar_rutinas_deportista(
        session=session,
        gym_id=current_staff.gimnasio_id,
        deportista_id=deportista_id,
        solo_activas=solo_activas,
    )


@router.get(
    "/rutinas-asignadas/{id}",
    response_model=RutinaAsignadaResponse,
    summary="Detalle completo de una rutina asignada con sus items de snapshot",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def obtener_rutina_asignada(
    id: UUID,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.obtener_rutina_asignada(
        session=session,
        gym_id=current_staff.gimnasio_id,
        rutina_asignada_id=id,
    )


@router.patch(
    "/rutinas-asignadas/{id}/estado",
    response_model=RutinaAsignadaResponse,
    summary="Activa o desactiva (archiva) una rutina asignada",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def cambiar_estado_rutina_asignada(
    id: UUID,
    req: CambiarEstadoRutinaAsignadaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.cambiar_estado_rutina_asignada(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        rutina_asignada_id=id,
        req=req,
    )


@router.put(
    "/rutinas-asignadas/{id}/personalizar",
    response_model=RutinaAsignadaResponse,
    summary="Personaliza una rutina asignada (Opción B: nuevo snapshot, desactiva anterior y preserva historial)",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def personalizar_rutina_asignada(
    id: UUID,
    req: PersonalizarRutinaAsignadaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    return await EntrenamientoService.personalizar_rutina_asignada(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        rutina_asignada_id=id,
        req=req,
    )
