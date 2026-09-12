"""
Router de FastAPI para el Módulo 4: Deportistas y Biometría (RF-17 a RF-23).
Define los 12 endpoints REST protegidos por permisos granulares en PostgreSQL
y autorización de rol Jefe para el procedimiento de derecho al olvido (Ley 1581).
"""
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_permission, require_role
from app.modules.deportistas.schemas import (
    CambiarEstadoDeportistaRequest,
    CrearDeportistaRequest,
    DeportistaBuscarResponse,
    DeportistaResponse,
    DeportistasPaginadosResponse,
    EditarDeportistaRequest,
    EnrolarHuellaRequest,
    FichaDeportistaResponse,
    HuellaInfoResponse,
    InvitacionAppResponse,
    MedicionCorporalResponse,
    RegistrarMedicionRequest,
    SuprimirDatosRequest,
)
from app.modules.deportistas.service import DeportistasService

router = APIRouter(prefix="/deportistas", tags=["04. Deportistas y Biometría"])


# =====================================================================
# 1. Registro y Pre-registro (RF-17, RF-19)
# =====================================================================

@router.post(
    "",
    response_model=DeportistaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar deportista (RF-17, RF-19)",
    description="Crea un deportista con validación estricta de consentimiento bajo Ley 1581 y unicidad de cédula por gimnasio.",
)
async def crear_deportista(
    req: CrearDeportistaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "crear"))],
):
    return await DeportistasService.crear_deportista(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        req=req,
    )


# =====================================================================
# 2. Listado Paginado (RF-17, RNF-09)
# =====================================================================

@router.get(
    "",
    response_model=DeportistasPaginadosResponse,
    status_code=status.HTTP_200_OK,
    summary="Listar deportistas paginado (RF-17)",
    description="Lista deportistas del gimnasio con filtros, búsqueda por texto y cálculo en tiempo real del estado de membresía.",
)
async def listar_deportistas(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "leer"))],
    q: Optional[str] = Query(None, description="Búsqueda por prefijo de documento o coincidencia de nombre"),
    activo: Optional[bool] = Query(None, description="Filtrar por estado activo/inactivo"),
    skip: int = Query(0, ge=0, description="Offset de paginación"),
    limit: int = Query(50, ge=1, le=100, description="Límite de registros por página"),
    orden_por: str = Query("nombre", description="Campo de ordenación: nombre, documento o created_at"),
    direccion: str = Query("asc", pattern="^(asc|desc)$", description="Dirección: asc o desc"),
):
    return await DeportistasService.listar_deportistas(
        session=session,
        gym_id=staff.gimnasio_id,
        q=q,
        activo=activo,
        skip=skip,
        limit=limit,
        orden_por=orden_por,
        direccion=direccion,
    )


# =====================================================================
# 3. Búsqueda Rápida para Autocomplete (RF-17)
# (Declarada ANTES de /{id} para evitar colisión de ruta en FastAPI)
# =====================================================================

@router.get(
    "/buscar",
    response_model=List[DeportistaBuscarResponse],
    status_code=status.HTTP_200_OK,
    summary="Búsqueda rápida para autocompletado (RF-17)",
    description="Optimizado para componentes de búsqueda en recepción y caja registradora.",
)
async def buscar_deportistas(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "leer"))],
    q: str = Query(..., min_length=1, description="Texto de búsqueda (cédula o nombre)"),
    limit: int = Query(10, ge=1, le=20, description="Cantidad máxima de coincidencias"),
):
    return await DeportistasService.buscar_deportistas(
        session=session,
        gym_id=staff.gimnasio_id,
        q=q,
        limit=limit,
    )


# =====================================================================
# 4. Ficha 360° del Deportista (RF-20)
# =====================================================================

@router.get(
    "/{id}",
    response_model=FichaDeportistaResponse,
    status_code=status.HTTP_200_OK,
    summary="Obtener ficha integral 360° del deportista (RF-20)",
    description="Retorna el perfil completo: membresía vigente, historial de pagos, accesos recientes, mediciones, huellas y app móvil.",
)
async def obtener_ficha(
    id: UUID,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "leer"))],
):
    return await DeportistasService.obtener_ficha(
        session=session,
        gym_id=staff.gimnasio_id,
        deportista_id=id,
    )


# =====================================================================
# 5. Edición de Deportista (Control Concurrencia Optimista)
# =====================================================================

@router.put(
    "/{id}",
    response_model=DeportistaResponse,
    status_code=status.HTTP_200_OK,
    summary="Editar datos del deportista (RF-17)",
    description="Actualiza datos con control de concurrencia optimista estricto (version) y protección de unicidad de cédula.",
)
async def editar_deportista(
    id: UUID,
    req: EditarDeportistaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "editar"))],
):
    return await DeportistasService.editar_deportista(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
        req=req,
    )


# =====================================================================
# 6. Activar / Desactivar Operativamente (RF-17)
# =====================================================================

@router.patch(
    "/{id}/estado",
    response_model=DeportistaResponse,
    status_code=status.HTTP_200_OK,
    summary="Activar o desactivar deportista (RF-17)",
    description="Modifica el estado operativo del deportista sin borrar su historial.",
)
async def cambiar_estado(
    id: UUID,
    req: CambiarEstadoDeportistaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "editar"))],
):
    return await DeportistasService.cambiar_estado(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
        req=req,
    )


# =====================================================================
# 7. Invitación para Activación de App Móvil (RF-18)
# =====================================================================

@router.post(
    "/{id}/invitacion-app",
    response_model=InvitacionAppResponse,
    status_code=status.HTTP_200_OK,
    summary="Generar invitación para activación de app (RF-18)",
    description="Genera código seguro y enlace de activación temporal para el deportista. La app es opcional.",
)
async def generar_invitacion_app(
    id: UUID,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "editar"))],
):
    return await DeportistasService.generar_invitacion_app(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
    )


# =====================================================================
# 8. Historial de Mediciones Corporales (RF-21)
# =====================================================================

@router.get(
    "/{id}/mediciones",
    response_model=List[MedicionCorporalResponse],
    status_code=status.HTTP_200_OK,
    summary="Consultar historial de mediciones (RF-21)",
    description="Historial cronológico de valoraciones físicas y medidas antropométricas registradas por el staff.",
)
async def listar_mediciones(
    id: UUID,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "leer"))],
):
    return await DeportistasService.listar_mediciones(
        session=session,
        gym_id=staff.gimnasio_id,
        deportista_id=id,
    )


@router.post(
    "/{id}/mediciones",
    response_model=MedicionCorporalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar medición corporal (RF-21)",
    description="Permite al staff registrar una nueva valoración antropométrica en el gimnasio.",
)
async def registrar_medicion(
    id: UUID,
    req: RegistrarMedicionRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "crear"))],
):
    return await DeportistasService.registrar_medicion(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
        req=req,
    )


# =====================================================================
# 9. Biometría de Huellas (RF-22, RNF-01)
# =====================================================================

@router.post(
    "/{id}/huellas",
    response_model=HuellaInfoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Enrolar huella dactilar (RF-22, RNF-01)",
    description="Cifra la plantilla biométrica en servidor con AES-256-GCM. El template nunca se expone en la API.",
)
async def enrolar_huella(
    id: UUID,
    req: EnrolarHuellaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "crear"))],
):
    return await DeportistasService.enrolar_huella(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
        req=req,
    )


@router.delete(
    "/{id}/huellas/{dedo}",
    status_code=status.HTTP_200_OK,
    summary="Eliminar huella dactilar (RF-22)",
    description="Elimina físicamente la plantilla biométrica de un dedo registrado.",
)
async def eliminar_huella(
    id: UUID,
    dedo: str,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_permission("deportistas", "eliminar"))],
):
    return await DeportistasService.eliminar_huella(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
        dedo=dedo,
    )


# =====================================================================
# 10. Supresión de Datos / Derecho al Olvido (RF-23, Ley 1581)
# =====================================================================

@router.post(
    "/{id}/suprimir-datos",
    status_code=status.HTTP_200_OK,
    summary="Supresión de datos / Derecho al olvido (RF-23, Ley 1581)",
    description="Procedimiento atómico reservado exclusivamente para el Jefe: borra biometría, anonimiza perfil y preserva retención contable.",
)
async def suprimir_datos(
    id: UUID,
    req: SuprimirDatosRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
):
    return await DeportistasService.suprimir_datos_ley_1581(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.staff_id,
        staff_nombre=staff.nombre,
        deportista_id=id,
        req=req,
    )
