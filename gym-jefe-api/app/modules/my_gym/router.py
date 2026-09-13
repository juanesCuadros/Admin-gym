"""
Router de endpoints HTTP para el Módulo 11: MyGymOS (Configuración del Gimnasio, RF-45 a RF-50).
Exposiciones:
- Información general de la sede, contacto, redes y horarios (RF-45)
- Mi landing y código QR generado en memoria (RF-46)
- Métodos de pago aceptados (RF-47)
- Parámetros por gimnasio con validación de rangos y efecto inmediato (RF-48)
- Registro y consulta de auditoría inmutable exclusiva para el Jefe con filtros y paginación (RF-49, RF-50)
- Control de Concurrencia Optimista (OCC)
"""
from datetime import date
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_permission, require_role
from app.modules.my_gym.schemas import (
    ActualizarBrandingRequest,
    ActualizarInfoGymRequest,
    ActualizarMetodosPagoRequest,
    ActualizarParametrosRequest,
    AuditoriaFiltrosDisponiblesResponse,
    AuditoriaPaginadaResponse,
    InfoGymResponse,
    LandingInfoResponse,
    ParametrosTenantResponse,
)
from app.modules.my_gym.service import MyGymService

router = APIRouter(prefix="/my-gym", tags=["11. Configuración MyGymOS"])


@router.get("/status", summary="Estado del módulo my_gym")
async def get_status():
    """Retorna el estado de disponibilidad del módulo de Configuración MyGymOS."""
    return {"modulo": "my_gym", "estado": "active"}


# ------------------------------------------------------------------------------
# RF-45, RF-47, RF-48: INFORMACIÓN GENERAL Y PARÁMETROS DEL TENANT
# ------------------------------------------------------------------------------

@router.get(
    "/info",
    response_model=InfoGymResponse,
    summary="Consultar información general, contacto, horarios y parámetros de la sede (RF-45, RF-47, RF-48)"
)
async def obtener_info_gym(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Retorna la información completa de la sede del gimnasio actual:
    - Nombre, dirección, ciudad, teléfono, correo oficial
    - Redes sociales y horarios de atención por rangos
    - Métodos de pago aceptados en caja
    - Políticas operativas (días gracia mora, tope congelamiento, umbral vencer)
    - Tokens de identidad visual y branding
    - Versión actual para concurrencia optimista (version)
    """
    return await MyGymService.obtener_info(
        session=session,
        gimnasio_id=current_staff.gimnasio_id
    )


@router.put(
    "/info",
    response_model=InfoGymResponse,
    summary="Actualizar información general de la sede, contacto, redes y horarios (RF-45)"
)
async def actualizar_info_gym(
    data: ActualizarInfoGymRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Actualiza la información comercial y de contacto de la sede.
    Requiere `version` para control de concurrencia optimista.
    Genera registro inmutable en `platform.auditoria_gym`.
    """
    return await MyGymService.actualizar_info(
        session=session,
        gimnasio_id=current_staff.gimnasio_id,
        data=data,
        current_staff=current_staff
    )


@router.patch(
    "/parametros",
    response_model=ParametrosTenantResponse,
    summary="Actualizar políticas operativas del gimnasio (RF-48)"
)
async def actualizar_parametros_tenant(
    data: ActualizarParametrosRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Actualiza las 3 políticas de negocio principales del gimnasio:
    - `dias_gracia_mora`: Rango [0..30] días
    - `tope_dias_congelamiento`: Rango [0..365] días
    - `dias_umbral_por_vencer`: Rango [1..60] días

    El cambio tiene efecto inmediato en Control de Ingreso, Membresías y Reportes.
    Requiere `version` para concurrencia optimista.
    Genera registro inmutable en `platform.auditoria_gym`.
    """
    return await MyGymService.actualizar_parametros(
        session=session,
        gimnasio_id=current_staff.gimnasio_id,
        data=data,
        current_staff=current_staff
    )


@router.put(
    "/metodos-pago",
    response_model=InfoGymResponse,
    summary="Configurar métodos de pago aceptados en caja (RF-47)"
)
async def actualizar_metodos_pago(
    data: ActualizarMetodosPagoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Configura la lista de métodos de pago aceptados por la sede en caja.
    Requiere `version` para concurrencia optimista.
    Genera registro inmutable en `platform.auditoria_gym`.
    """
    return await MyGymService.actualizar_metodos_pago(
        session=session,
        gimnasio_id=current_staff.gimnasio_id,
        data=data,
        current_staff=current_staff
    )


@router.patch(
    "/branding",
    response_model=InfoGymResponse,
    summary="Actualizar colores corporativos e identidad visual de la sede"
)
async def actualizar_branding(
    data: ActualizarBrandingRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Actualiza la paleta de colores corporativos (primary, secondary, accent) y URLs de logos.
    Requiere `version` para concurrencia optimista.
    Genera registro inmutable en `platform.auditoria_gym`.
    """
    return await MyGymService.actualizar_branding(
        session=session,
        gimnasio_id=current_staff.gimnasio_id,
        data=data,
        current_staff=current_staff
    )


# ------------------------------------------------------------------------------
# RF-46: MI LANDING Y QR (SOLO LECTURA)
# ------------------------------------------------------------------------------

@router.get(
    "/landing",
    response_model=LandingInfoResponse,
    summary="Consultar enlace público y código QR de la sede (RF-46, solo lectura)"
)
async def obtener_landing(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Retorna la URL canónica pública de la landing y el código QR vectorial en formato SVG
    generado en memoria para visualización o incrustación web sin tocar disco.
    Solo lectura. El slug y dominio son inmutables desde la sede.
    """
    return await MyGymService.obtener_landing(
        session=session,
        gimnasio_id=current_staff.gimnasio_id
    )


@router.get(
    "/landing/qr.png",
    summary="Descargar imagen PNG del código QR de la sede (RF-46)"
)
async def descargar_qr_png(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Genera y descarga directamente en memoria la imagen binaria PNG del código QR
    de la sede para impresión física en recepción y torniquetes.
    """
    png_bytes = await MyGymService.generar_qr_png_bytes(
        session=session,
        gimnasio_id=current_staff.gimnasio_id
    )
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="qr_gymos.png"'}
    )


# ------------------------------------------------------------------------------
# RF-49 & RF-50: AUDITORÍA CON FILTROS (EXCLUSIVO JEFE)
# ------------------------------------------------------------------------------

@router.get(
    "/auditoria",
    response_model=AuditoriaPaginadaResponse,
    summary="Consultar feed de auditoría inmutable del gimnasio con filtros y paginación (RF-49, RF-50)"
)
async def consultar_auditoria(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (YYYY-MM-DD)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (YYYY-MM-DD)"),
    actor_id: Optional[UUID] = Query(None, description="ID del miembro de staff que ejecutó la acción"),
    accion: Optional[str] = Query(None, description="Acción específica (ej. crear_venta, anular_venta, ajuste_stock)"),
    entidad: Optional[str] = Query(None, description="Entidad afectada (ej. venta, pago_membresia, staff, tenant)"),
    q: Optional[str] = Query(None, description="Búsqueda libre por nombre de actor, id de entidad o acción"),
    page: int = Query(1, ge=1, description="Número de página (1-indexado)"),
    page_size: int = Query(50, ge=1, le=100, description="Tamaño de página (máximo 100)")
):
    """
    RF-49, RF-50: Consulta el registro de auditoría append-only con encadenamiento criptográfico (SHA-256).
    
    REGLA DE SEGURIDAD:
    - Visible ÚNICAMENTE para usuarios con rol 'jefe'.
    - Recepcionistas y entrenadores reciben 403 Forbidden (ROL_NO_AUTORIZADO).
    - Los filtros aprovechan los índices B-Tree compuestos con prefijo gimnasio_id.
    """
    return await MyGymService.consultar_auditoria(
        session=session,
        gimnasio_id=current_staff.gimnasio_id,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        actor_id=actor_id,
        accion=accion,
        entidad=entidad,
        q=q,
        page=page,
        page_size=page_size
    )


@router.get(
    "/auditoria/filtros",
    response_model=AuditoriaFiltrosDisponiblesResponse,
    summary="Obtener acciones y entidades registradas para filtros dinámicos (RF-50)"
)
async def obtener_filtros_auditoria(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Retorna la lista de acciones y entidades que efectivamente tienen eventos registrados
    para el tenant actual, permitiendo armar dropdowns dinámicos en el frontend.
    Exclusivo para el Jefe.
    """
    return await MyGymService.obtener_filtros_disponibles(
        session=session,
        gimnasio_id=current_staff.gimnasio_id
    )
