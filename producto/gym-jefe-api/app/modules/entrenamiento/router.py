"""
Endpoints REST para el Módulo 6: Entrenamiento (RF-28 a RF-31).
Documentación OpenAPI / Swagger completa con reglas de negocio, permisos y descripciones.
"""
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, status
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
    summary="Catálogo de ejercicios con activación por sede y GIF condicional (RF-28)",
    description=(
        "Consulta el catálogo híbrido de ejercicios (globales del sistema y propios de la sede).\n\n"
        "**Regla de Supresión de GIF:**\n"
        "Si un ejercicio está inactivo en la sede (`activo_en_gym=false`), se omite la URL del GIF (`archivo_url=None`) "
        "para evitar inducir a su realización sin disponibilidad física en el gimnasio.\n\n"
        "**Filtros:** Búsqueda textual por nombre (español o inglés), grupo muscular, categoría, equipo, "
        "solo propios o globales, y disponibilidad en la sede."
    ),
    response_description="Listado paginado de ejercicios con estado de disponibilidad en sede",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def listar_ejercicios(
    busqueda: Optional[str] = Query(None, description="Búsqueda por nombre en español o inglés"),
    grupo_muscular: Optional[str] = Query(None, description="Filtro por grupo muscular (ej. Pecho, Espalda, Piernas)"),
    categoria: Optional[str] = Query(None, description="Filtro por categoría (Fuerza, Cardio, Flexibilidad)"),
    equipo: Optional[str] = Query(None, description="Filtro por equipamiento necesario (Mancuernas, Barra, Máquina)"),
    solo_propios: bool = Query(False, description="Filtrar exclusivamente ejercicios creados por el gimnasio"),
    solo_globales: bool = Query(False, description="Filtrar exclusivamente ejercicios provistos por la plataforma"),
    solo_activos_sede: Optional[bool] = Query(None, description="Filtrar por disponibilidad activa en esta sede"),
    skip: int = Query(0, ge=0, description="Paginación: cantidad de registros a omitir"),
    limit: int = Query(50, ge=1, le=100, description="Paginación: cantidad máxima de registros por página"),
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Retorna el catálogo de ejercicios con soporte para filtrado facetado y visibilidad de medios controlada.
    """
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
    summary="Crear ejercicio propio del gimnasio (RF-28)",
    description=(
        "Registra un nuevo ejercicio personalizado para uso exclusivo de los entrenadores de este gimnasio.\n\n"
        "**Características:**\n"
        "- Se marca como `propio=true` vinculado al `gimnasio_id` autenticado.\n"
        "- Inicia con control de concurrencia optimista (`version=1`).\n"
        "- Requiere nombre en español, grupo muscular, equipo y categoría."
    ),
    response_description="Ejercicio propio creado con identificador UUID",
    dependencies=[Depends(require_permission("entrenamiento", "crear"))],
)
async def crear_ejercicio_propio(
    req: CrearEjercicioPropioRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Crea un nuevo ejercicio en la biblioteca propia del gimnasio.
    """
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
    summary="Detalle de un ejercicio del catálogo (RF-28)",
    description=(
        "Consulta la ficha técnica de un ejercicio (global o propio).\n\n"
        "Aplica la regla de visualización condicional: si el ejercicio no está disponible en la sede, "
        "el campo `archivo_url` se retorna como `null`."
    ),
    response_description="Ficha completa del ejercicio",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def obtener_ejercicio(
    id: Annotated[UUID, Path(description="UUID identificador del ejercicio")],
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Obtiene la información técnica e instrucciones de un ejercicio por su UUID.
    """
    return await EntrenamientoService.obtener_ejercicio(
        session=session,
        gym_id=current_staff.gimnasio_id,
        ejercicio_id=id,
    )


@router.put(
    "/ejercicios/{id}",
    response_model=EjercicioResponse,
    summary="Editar ejercicio propio con concurrencia optimista (RF-28)",
    description=(
        "Actualiza los datos de un ejercicio propio del gimnasio.\n\n"
        "**Seguridad y Concurrencia:**\n"
        "- Rechaza la edición de ejercicios globales del sistema con error `403`.\n"
        "- Requiere enviar la `version` actual; si otro usuario modificó el ejercicio previamente, "
        "responde `409 CONFLICT` con código `CONFLICTO_CONCURRENCIA`."
    ),
    response_description="Ejercicio propio actualizado con versión incrementada",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def editar_ejercicio_propio(
    id: Annotated[UUID, Path(description="UUID identificador del ejercicio propio a editar")],
    req: EditarEjercicioPropioRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Edita un ejercicio propio del gimnasio bajo control de concurrencia optimista.
    """
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
    summary="Activar o desactivar ejercicio en la sede (RF-28)",
    description=(
        "Habilita o deshabilita la disponibilidad de un ejercicio en la sede actual.\n\n"
        "- Para ejercicios propios, actualiza su campo `activo`.\n"
        "- Para ejercicios globales del sistema, crea o actualiza el registro en `platform.gimnasio_ejercicio`.\n"
        "- Si se desactiva, su GIF multimedia queda suprimido de las consultas."
    ),
    response_description="Ejercicio con su nuevo estado de disponibilidad en la sede",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def cambiar_estado_ejercicio(
    id: Annotated[UUID, Path(description="UUID identificador del ejercicio")],
    req: CambiarEstadoEjercicioRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Habilita o deshabilita un ejercicio dentro de la sede.
    """
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
    summary="Crear plantilla de rutina reutilizable (RF-29)",
    description=(
        "Crea una plantilla de rutina estructurada con su lista ordenada de ejercicios.\n\n"
        "**Comportamiento:**\n"
        "- Inserta de forma atómica la cabecera en `platform.rutinas_plantilla` y los ítems en `platform.rutina_plantilla_items`.\n"
        "- Inicia con control de versión optimista (`version=1`).\n"
        "- Cada ítem especifica orden, series, repeticiones, peso sugerido, descanso y notas de ejecución."
    ),
    response_description="Plantilla de rutina creada con sus ejercicios ordenados",
    dependencies=[Depends(require_permission("entrenamiento", "crear"))],
)
async def crear_plantilla(
    req: CrearPlantillaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Crea una nueva plantilla de entrenamiento reutilizable para el gimnasio.
    """
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
    summary="Listar plantillas de rutina del gimnasio (RF-29)",
    description=(
        "Retorna el catálogo de plantillas de rutina del gimnasio con soporte para paginación y búsqueda por texto en nombre o descripción."
    ),
    response_description="Listado paginado de plantillas disponibles",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def listar_plantillas(
    busqueda: Optional[str] = Query(None, description="Búsqueda por texto en nombre o descripción de la plantilla"),
    skip: int = Query(0, ge=0, description="Paginación: registros a omitir"),
    limit: int = Query(50, ge=1, le=100, description="Paginación: registros por página"),
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Lista las plantillas de entrenamiento existentes en la sede.
    """
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
    summary="Detalle completo de una plantilla de rutina (RF-29)",
    description=(
        "Consulta la ficha detallada de una plantilla de rutina, incluyendo metadatos de versión y "
        "la lista de ejercicios configurados con sus series, repeticiones y reglas de visualización de GIF."
    ),
    response_description="Plantilla con detalle completo de ejercicios y configuración",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def obtener_plantilla(
    id: Annotated[UUID, Path(description="UUID identificador de la plantilla")],
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Obtiene la plantilla de rutina especificada junto con sus ítems de ejercicios.
    """
    return await EntrenamientoService.obtener_plantilla(
        session=session,
        gym_id=current_staff.gimnasio_id,
        plantilla_id=id,
    )


@router.put(
    "/plantillas/{id}",
    response_model=RutinaPlantillaResponse,
    summary="Editar plantilla con concurrencia optimista (RF-29)",
    description=(
        "Actualiza los datos y la lista de ejercicios de una plantilla de rutina existente.\n\n"
        "**Protección de Concurrencia:**\n"
        "Verifica que la `version` enviada coincida con la registrada en base de datos. "
        "Si otro entrenador modificó la plantilla simultáneamente, responde `409 CONFLICT`."
    ),
    response_description="Plantilla de rutina actualizada con versión incrementada",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def editar_plantilla(
    id: Annotated[UUID, Path(description="UUID identificador de la plantilla a editar")],
    req: EditarPlantillaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Actualiza la cabecera y el conjunto de ítems de una plantilla de rutina existente.
    """
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
    summary="Eliminar plantilla de rutina (RF-29)",
    description=(
        "Elimina una plantilla de rutina del catálogo.\n\n"
        "**Garantía de Integridad y Snapshot Inmutable:**\n"
        "Las rutinas que ya fueron asignadas a deportistas a partir de esta plantilla NO se alteran ni eliminan "
        "(`ON DELETE SET NULL`), preservando su copia inmutable y su nombre original intactos."
    ),
    response_description="Confirmación de eliminación exitosa de la plantilla",
    dependencies=[Depends(require_permission("entrenamiento", "eliminar"))],
)
async def eliminar_plantilla(
    id: Annotated[UUID, Path(description="UUID identificador de la plantilla a eliminar")],
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Elimina una plantilla sin corromper las asignaciones históricas de los deportistas.
    """
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
    summary="Asignar rutina a deportista con snapshot inmutable (RF-30)",
    description=(
        "Asigna una rutina a un deportista basándose en una plantilla existente o con ejercicios directos.\n\n"
        "**Garantía de Snapshot Inmutable (RF-30):**\n"
        "- Copia físicamente el nombre de la plantilla a `platform.rutinas_asignadas.nombre` para autosuficiencia.\n"
        "- Clona los ítems de ejercicios a `platform.rutina_asignada_items` con sus series, repeticiones y cargas.\n"
        "- Modificaciones o borrados posteriores de la plantilla o de los ejercicios NO afectarán la rutina asignada."
    ),
    response_description="Rutina asignada creada con su snapshot inmutable de ejercicios",
    dependencies=[Depends(require_permission("entrenamiento", "crear"))],
)
async def asignar_rutina(
    req: AsignarRutinaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Asigna un plan de entrenamiento individualizado a un deportista clonando un snapshot inmutable.
    """
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
    summary="Historial de rutinas asignadas a un deportista (RF-31)",
    description=(
        "Retorna la lista de todas las rutinas asignadas al deportista especificado.\n\n"
        "Permite consultar el histórico completo (activas y archivadas) o filtrar únicamente la rutina activa vigente."
    ),
    response_description="Listado cronológico de rutinas asignadas al deportista",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def listar_rutinas_deportista(
    deportista_id: Annotated[UUID, Path(description="UUID identificador del deportista")],
    solo_activas: bool = Query(False, description="Filtrar únicamente rutinas que se encuentren activas"),
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Consulta las rutinas asignadas e historial de entrenamiento de un deportista.
    """
    return await EntrenamientoService.listar_rutinas_deportista(
        session=session,
        gym_id=current_staff.gimnasio_id,
        deportista_id=deportista_id,
        solo_activas=solo_activas,
    )


@router.get(
    "/rutinas-asignadas/{id}",
    response_model=RutinaAsignadaResponse,
    summary="Detalle de rutina asignada con snapshot de ítems (RF-31)",
    description=(
        "Consulta la información completa de una rutina asignada específica.\n\n"
        "Incluye el snapshot inmutable de ejercicios con sus series, repeticiones, cargas, descanso y notas."
    ),
    response_description="Detalle completo de la rutina asignada y sus ejercicios",
    dependencies=[Depends(require_permission("entrenamiento", "leer"))],
)
async def obtener_rutina_asignada(
    id: Annotated[UUID, Path(description="UUID identificador de la rutina asignada")],
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Obtiene la ficha técnica de una rutina asignada con su snapshot inmutable de ejercicios.
    """
    return await EntrenamientoService.obtener_rutina_asignada(
        session=session,
        gym_id=current_staff.gimnasio_id,
        rutina_asignada_id=id,
    )


@router.patch(
    "/rutinas-asignadas/{id}/estado",
    response_model=RutinaAsignadaResponse,
    summary="Activar o archivar rutina asignada (RF-30)",
    description=(
        "Modifica el estado (`activa = true/false`) de una rutina asignada al deportista."
    ),
    response_description="Rutina asignada con su estado actualizado",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def cambiar_estado_rutina_asignada(
    id: Annotated[UUID, Path(description="UUID identificador de la rutina asignada")],
    req: CambiarEstadoRutinaAsignadaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Activa o desactiva (archiva) una rutina asignada a un deportista.
    """
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
    summary="Personalizar rutina asignada (Opción B: nuevo snapshot inmutable) (RF-30)",
    description=(
        "Personaliza una rutina asignada a un deportista bajo la **Opción B** de arquitectura inmutable:\n\n"
        "1. **No sobreescribe:** La rutina previa no se muta; se marca como `activa = false`.\n"
        "2. **Nuevo snapshot:** Crea un nuevo registro en `platform.rutinas_asignadas` (`activa = true`) "
        "con su propio snapshot independiente de ejercicios en `platform.rutina_asignada_items`.\n"
        "3. **Trazabilidad completa:** Preserva intacto el historial de qué ejercicios y cargas realizó "
        "el deportista en cada etapa de su entrenamiento."
    ),
    response_description="Nueva rutina asignada creada con el snapshot personalizado y estado activa=true",
    dependencies=[Depends(require_permission("entrenamiento", "editar"))],
)
async def personalizar_rutina_asignada(
    id: Annotated[UUID, Path(description="UUID identificador de la rutina asignada actual a personalizar")],
    req: PersonalizarRutinaAsignadaRequest,
    current_staff: AuthenticatedStaff = Depends(get_current_staff),
    session: AsyncSession = Depends(get_db_session),
):
    """
    Personaliza una rutina archivando la anterior y creando una nueva con su propio snapshot inmutable.
    """
    return await EntrenamientoService.personalizar_rutina_asignada(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        rutina_asignada_id=id,
        req=req,
    )
