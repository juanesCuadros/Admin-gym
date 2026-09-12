from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, status
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
    summary="Programar clase única o serie recurrente (RF-32)",
    description=(
        "Programa una clase individual o proyecta una serie recurrente para el gimnasio.\n\n"
        "**Características y Reglas:**\n"
        "- **Omisión de festivos:** Si `omitir_festivos=true`, excluye automáticamente los 18 festivos oficiales "
        "de Colombia (Ley Emiliani y Pascua).\n"
        "- **Profesor:** Debe asignarse un entrenador interno (`entrenador_id`) o un profesor externo (`profesor_externo`).\n"
        "- **Recurrencia:** Permite especificar días de la semana y semanas a proyectar.\n"
        "- **Auditoría:** Registra el evento en `platform.auditoria_gym` con hash SHA-256."
    ),
    response_description="Clase programada con detalle de cupos y recurrencia",
    dependencies=[Depends(require_permission("clases", "crear"))],
)
async def programar_clase(
    req: ProgramarClaseRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Programa una clase individual o una serie recurrente de clases en el calendario de la sede.
    """
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
    summary="Listar agenda de clases con filtros y cupos en tiempo real (RF-32)",
    description=(
        "Retorna la agenda de clases del gimnasio con soporte de paginación y filtros dinámicos.\n\n"
        "**Filtros disponibles:**\n"
        "- `desde` / `hasta`: Rango temporal en formato ISO 8601.\n"
        "- `entrenador_id`: UUID del entrenador asignado.\n"
        "- `tipo`: Filtro por disciplina deportiva (ej. 'Spinning', 'Yoga', 'Funcional').\n"
        "- `estado`: Estado de la clase ('programada', 'cancelada', 'realizada').\n\n"
        "Calcula en tiempo real los cupos disponibles (`cupos_disponibles = cupo - reservas_activas`)."
    ),
    response_description="Listado paginado de clases del gimnasio",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def listar_clases(
    desde: Optional[datetime] = Query(None, description="Fecha y hora de inicio para el rango de búsqueda (ISO 8601)"),
    hasta: Optional[datetime] = Query(None, description="Fecha y hora de fin para el rango de búsqueda (ISO 8601)"),
    entrenador_id: Optional[UUID] = Query(None, description="UUID del entrenador para filtrar clases asignadas"),
    tipo: Optional[str] = Query(None, description="Disciplina o categoría de la clase (ej. 'Spinning', 'CrossFit')"),
    estado: Optional[str] = Query(None, description="Estado de la clase: 'programada', 'cancelada' o 'realizada'"),
    skip: int = Query(0, ge=0, description="Cantidad de registros a omitir para paginación"),
    limit: int = Query(50, ge=1, le=100, description="Cantidad máxima de registros por página (máx. 100)"),
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)] = None,
    session: Annotated[AsyncSession, Depends(get_db_session)] = None,
):
    """
    Consulta el calendario de clases con cálculo dinámico de reservas y cupos disponibles.
    """
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
    summary="Detalle de una clase programada (RF-32)",
    description=(
        "Consulta la información detallada de una clase específica.\n\n"
        "Incluye el nombre de la disciplina, el entrenador asignado o profesor externo, "
        "el cupo máximo, las reservas vigentes contabilizadas y los cupos disponibles actuales."
    ),
    response_description="Ficha completa de la clase programada",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def obtener_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Obtiene la ficha técnica de una clase individual por su identificador UUID.
    """
    return await ClasesService.obtener_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )


@router.put(
    "/{id}",
    response_model=ClaseResponse,
    summary="Editar clase programada (RF-32)",
    description=(
        "Actualiza los metadatos de una clase existente.\n\n"
        "**Restricciones:**\n"
        "- Solo se pueden modificar clases en estado `'programada'`.\n"
        "- Permite actualizar nombre, tipo, profesor/entrenador, cupo y horario.\n"
        "- Si se modifica el cupo, no puede ser inferior a 1."
    ),
    response_description="Clase con sus metadatos actualizados",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def editar_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase a modificar")],
    req: EditarClaseRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Modifica los parámetros de programación de una clase activa.
    """
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
    summary="Cancelar clase y liberar pases de reservas (RF-32, RF-33)",
    description=(
        "Cancela una clase programada y ejecuta la cancelación en cascada de sus reservas.\n\n"
        "**Liberación de pases pagados (`venta_item_id`):**\n"
        "- Todas las reservas en estado `'reservada'` se actualizan a `'cancelada'`.\n"
        "- Al cancelarse, cualquier pase pagado en Caja (`venta_item_id`) queda automáticamente "
        "liberado para ser reutilizado por el deportista en otra clase futura."
    ),
    response_description="Clase marcada en estado 'cancelada'",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def cancelar_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase a cancelar")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Cancela una clase del cronograma y libera automáticamente los pases de las reservas vigentes.
    """
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
    summary="Reservar cupo en una clase (RF-33)",
    description=(
        "Registra la reserva de un cupo para un deportista en la clase indicada.\n\n"
        "**Validaciones y Reglas de Negocio:**\n"
        "1. **Restricción temporal:** Rechaza reservas si la clase ya inició o terminó (`fecha_hora <= now_utc()`).\n"
        "2. **Aforo disponible:** Valida que el aforo no esté agotado (`reservas_actuales < cupo`).\n"
        "3. **Doble reserva:** Previene que un deportista tenga más de una reserva activa en la misma clase.\n"
        "4. **Membresía activa vs Pase pagado:**\n"
        "   - Si el deportista cuenta con membresía activa o por vencer, reserva sin costo (`pase_pagado=false`).\n"
        "   - Si el deportista no cuenta con membresía activa (vencido, mora, congelado, sin membresía), "
        "exige suministrar `venta_item_id` correspondiente a un pase de clase adquirido en Caja.\n"
        "5. **Protección contra doble gasto:** Un `venta_item_id` no puede usarse en más de una reserva activa simultánea."
    ),
    response_description="Reserva confirmada con identificador único y estado 'reservada'",
    dependencies=[Depends(require_permission("clases", "crear"))],
)
async def crear_reserva(
    id: Annotated[UUID, Path(description="UUID identificador de la clase a reservar")],
    req: CrearReservaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Crea una reserva de cupo para un deportista, validando su estado de membresía o pase pagado en Caja.
    """
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
    summary="Listar reservas de una clase (RF-33)",
    description=(
        "Retorna la lista de todas las reservas registradas para la clase especificada.\n\n"
        "Muestra el estado de cada reserva (`'reservada'`, `'asistio'`, `'no_show'`, `'cancelada'`), "
        "así como el medio de acceso utilizado (`pase_pagado` y `venta_item_id` si aplica)."
    ),
    response_description="Listado cronológico de reservas de la clase",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def listar_reservas_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Lista las reservas históricas y vigentes asociadas a una clase.
    """
    return await ClasesService.listar_reservas_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )


@router.delete(
    "/{clase_id}/reservas/{reserva_id}",
    response_model=ReservaResponse,
    summary="Cancelar reserva y liberar cupo/pase (RF-33)",
    description=(
        "Cancela una reserva individual liberando de inmediato el cupo para otros deportistas.\n\n"
        "**Liberación de Pase Pagado:**\n"
        "Si la reserva fue realizada mediante un pase de clase pagado (`venta_item_id`), "
        "el pase queda disponible para reutilizarse en otra clase futura."
    ),
    response_description="Reserva cancelada con estado 'cancelada'",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def cancelar_reserva(
    clase_id: Annotated[UUID, Path(description="UUID identificador de la clase")],
    reserva_id: Annotated[UUID, Path(description="UUID identificador de la reserva a cancelar")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Cancela una reserva vigente y libera el cupo en la clase y el pase pagado si corresponde.
    """
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
    summary="Registrar asistencia con check-in de torniquete del mismo día (RF-34)",
    description=(
        "Confirma la presencia y asistencia efectiva de un deportista en la clase grupal.\n\n"
        "**Condiciones Requeridas:**\n"
        "1. El deportista debe contar con una reserva activa en estado `'reservada'`.\n"
        "2. **Check-in previo en torniquete:** Exige que el deportista haya ingresado por el torniquete "
        "el mismo día calendario de la clase (evaluado con `get_local_day_range_utc` en zona horaria local de Bogotá).\n"
        "3. **Límite de proximidad:** El ingreso al gimnasio debe haberse producido antes o máximo dentro de las "
        "2 horas posteriores al inicio programado de la clase (`ts_utc <= fecha_hora + 2h`).\n"
        "4. Actualiza la reserva a `'asistio'` y vincula el `checkin_id` correspondiente."
    ),
    response_description="Registro de asistencia confirmado con checkin_id vinculado",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def registrar_asistencia(
    id: Annotated[UUID, Path(description="UUID identificador de la clase")],
    req: RegistrarAsistenciaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Valida el ingreso físico al gimnasio y registra la asistencia oficial a la clase.
    """
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
    summary="Resumen de asistencia y ausencias de la clase (RF-34)",
    description=(
        "Retorna la consolidación de asistencia de la clase:\n\n"
        "- Lista de deportistas con asistencia confirmada (`checkin_id`, timestamp).\n"
        "- Lista de deportistas ausentes o con reserva pendiente de confirmación.\n"
        "- Contadores totales de asistentes y ausentes."
    ),
    response_description="Resumen de asistencia con listados de confirmados y ausentes",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def obtener_resumen_asistencia(
    id: Annotated[UUID, Path(description="UUID identificador de la clase")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Consulta el balance consolidado de asistentes y ausentes de una clase.
    """
    return await ClasesService.obtener_resumen_asistencia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )


@router.post(
    "/{id}/cerrar",
    response_model=ClaseResponse,
    summary="Cerrar clase y marcar ausencias como no_show (RF-34)",
    description=(
        "Finaliza formalmente la ejecución de una clase realizada.\n\n"
        "**Efectos del cierre:**\n"
        "- Cambia el estado de la clase a `'realizada'`.\n"
        "- Todas las reservas que permanecían en estado `'reservada'` pasan automáticamente a `'no_show'`.\n"
        "- Registra evento de cierre en la auditoría inmutable SHA-256."
    ),
    response_description="Clase cerrada en estado 'realizada'",
    dependencies=[Depends(require_permission("clases", "editar"))],
)
async def cerrar_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase a cerrar")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Cierra la clase realizada, actualizando reservas no asistidas a no_show y sellando auditoría.
    """
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
    summary="Calificar clase de 1 a 5 estrellas (RF-35)",
    description=(
        "Permite que un deportista califique la clase grupal a la que asistió.\n\n"
        "**Reglas:**\n"
        "- El puntaje debe ser un entero entre `1` y `5` estrellas.\n"
        "- Comentario de texto opcional.\n"
        "- **Exclusivo para asistentes:** Valida en `platform.asistencia_clase` que el deportista haya asistido a la clase.\n"
        "- Previene calificaciones duplicadas del mismo deportista para la misma clase."
    ),
    response_description="Calificación registrada exitosamente",
    dependencies=[Depends(require_permission("clases", "crear"))],
)
async def calificar_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase a calificar")],
    req: CrearCalificacionRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Registra la valoración de un deportista que asistió a la clase.
    """
    return await ClasesService.calificar_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
        req=req,
    )


@router.get(
    "/{id}/calificaciones",
    response_model=ResumenCalificacionesResponse,
    summary="Consultar satisfacción y métricas de calificación (RF-35)",
    description=(
        "Consulta las calificaciones y métricas de satisfacción de una clase.\n\n"
        "Retorna el promedio ponderado, el total de calificaciones emitidas, "
        "el desglose por cantidad de estrellas (1 a 5) y la lista de comentarios recibidos."
    ),
    response_description="Resumen de satisfacción y distribución de calificaciones de la clase",
    dependencies=[Depends(require_permission("clases", "leer"))],
)
async def obtener_calificaciones_clase(
    id: Annotated[UUID, Path(description="UUID identificador de la clase")],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    """
    Obtiene las métricas de satisfacción y el promedio de calificaciones de la clase.
    """
    return await ClasesService.obtener_calificaciones_clase(
        session=session,
        gym_id=current_staff.gimnasio_id,
        clase_id=id,
    )
