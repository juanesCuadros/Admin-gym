from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedDeportista, get_current_deportista
from app.modules.portal_deportista.schemas import (
    ActualizarPerfilDeportistaRequest,
    AsistenciasPortalResponse,
    EstablecerPasswordDeportistaRequest,
    FinanzasDeportistaResponse,
    IniciarAccesoDeportistaRequest,
    IniciarAccesoDeportistaResponse,
    LoginDeportistaResponse,
    LoginPasswordDeportistaRequest,
    MedicionesPortalResponse,
    MedicionPortalItem,
    PerfilDeportistaResponse,
    RegistrarMedicionPortalRequest,
    ValidarPinDeportistaRequest,
    ValidarPinDeportistaResponse,
)
from app.modules.portal_deportista.service import PortalDeportistaService

router = APIRouter(prefix="/portal", tags=["12. Portal del Deportista"])


# =====================================================================
# 1. RUTAS PÚBLICAS DE AUTENTICACIÓN Y ACTIVACIÓN CON PIN
# =====================================================================

@router.post(
    "/auth/iniciar",
    response_model=IniciarAccesoDeportistaResponse,
    summary="Paso 1: Ingresar correo (envía PIN por correo si es 1ra vez o recuperación, con protección anti-enumeración)",
)
async def iniciar_acceso_portal(
    data: IniciarAccesoDeportistaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.iniciar_acceso(session, data)


@router.post(
    "/auth/validar-pin",
    response_model=ValidarPinDeportistaResponse,
    summary="Paso 2: Validar código PIN de 6 dígitos y emitir ticket temporal para crear contraseña",
)
async def validar_pin_portal(
    data: ValidarPinDeportistaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.validar_pin(session, data)


@router.post(
    "/auth/establecer-password",
    response_model=LoginDeportistaResponse,
    summary="Paso 3: Establecer y confirmar contraseña segura e iniciar sesión automáticamente",
)
async def establecer_password_portal(
    data: EstablecerPasswordDeportistaRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.establecer_password(session, data)


@router.post(
    "/auth/login",
    response_model=LoginDeportistaResponse,
    summary="Iniciar sesión con correo y contraseña (deportistas ya activados)",
)
async def login_portal(
    data: LoginPasswordDeportistaRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    client_ip = request.client.host if request.client else None
    return await PortalDeportistaService.login_password(session, data, client_ip)


# =====================================================================
# 2. RUTAS PROTEGIDAS DEL DEPORTISTA (CERO IDOR)
# =====================================================================

@router.get(
    "/perfil",
    response_model=PerfilDeportistaResponse,
    summary="Obtener perfil, estado de membresía y resumen del deportista autenticado",
)
async def get_perfil_portal(
    current_dep: Annotated[AuthenticatedDeportista, Depends(get_current_deportista)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.obtener_perfil(session, current_dep)


@router.patch(
    "/perfil",
    response_model=PerfilDeportistaResponse,
    summary="Actualizar nombre y datos personales autorizados del deportista",
)
async def patch_perfil_portal(
    req: ActualizarPerfilDeportistaRequest,
    current_dep: Annotated[AuthenticatedDeportista, Depends(get_current_deportista)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.actualizar_perfil(session, current_dep, req)


@router.get(
    "/finanzas",
    response_model=FinanzasDeportistaResponse,
    summary="Consultar historial de pagos de membresías y compras en tienda del deportista",
)
async def get_finanzas_portal(
    current_dep: Annotated[AuthenticatedDeportista, Depends(get_current_deportista)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.obtener_finanzas(session, current_dep)


@router.get(
    "/mediciones",
    response_model=MedicionesPortalResponse,
    summary="Obtener historial de medidas corporales y resumen de progreso",
)
async def get_mediciones_portal(
    current_dep: Annotated[AuthenticatedDeportista, Depends(get_current_deportista)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.obtener_mediciones(session, current_dep)


@router.post(
    "/mediciones",
    response_model=MedicionPortalItem,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar nueva medición corporal desde el portal con cálculo automático de progreso",
)
async def post_medicion_portal(
    req: RegistrarMedicionPortalRequest,
    current_dep: Annotated[AuthenticatedDeportista, Depends(get_current_deportista)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.registrar_medicion(session, current_dep, req)


@router.get(
    "/asistencias",
    response_model=AsistenciasPortalResponse,
    summary="Consultar resumen, calendario mensual e historial de asistencias al gimnasio",
)
async def get_asistencias_portal(
    current_dep: Annotated[AuthenticatedDeportista, Depends(get_current_deportista)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await PortalDeportistaService.obtener_asistencias(session, current_dep)

