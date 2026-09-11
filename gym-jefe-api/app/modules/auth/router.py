from typing import Annotated, List
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import (
    AuthenticatedStaff,
    get_current_staff,
    get_db_session,
    require_role,
)
from app.modules.auth.schemas import (
    ActualizarMatrizPermisosRequest,
    ApiResponse,
    ConfirmarRecuperacionRequest,
    LoginRequest,
    LoginResponseDto,
    PermisoMatrizItemDto,
    RefreshResponseDto,
    RefreshTokenRequest,
    SolicitarRecuperacionRequest,
    UsuarioAuthDto,
)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["00. Autenticación y Autorización"])


@router.post(
    "/login",
    response_model=LoginResponseDto,
    summary="Iniciar sesión staff (RF-00.1, RF-00.4)"
)
async def login(
    data: LoginRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Autentica al usuario validando:
    1. Resolución de subdominio (tenant).
    2. Bloqueo temporal por 15 min ante 5 intentos fallidos (cuenta) o 15 (IP).
    3. Validación de contraseña con Argon2id contra platform.staff filtrado por gimnasio_id.
    4. Aplicación de RLS en una sola transacción atómica.
    """
    client_ip = request.client.host if request.client else None
    return await AuthService.login(session, data, client_ip)


@router.post(
    "/refresh",
    response_model=RefreshResponseDto,
    summary="Refrescar token de acceso (RF-00.1)"
)
async def refresh_token(
    data: RefreshTokenRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Renueva el access token y recalcula en tiempo real los permisos canónicos.
    """
    return await AuthService.refresh(session, data)


@router.post(
    "/logout",
    response_model=ApiResponse,
    summary="Cerrar sesión activa (RF-00.3)"
)
async def logout(
    data: RefreshTokenRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)]
):
    """
    Invalida el refresh token de forma segura dentro de su gimnasio.
    """
    await AuthService.logout(session, current_staff.gimnasio_id, data.refresh_token)
    return ApiResponse(message="Sesión cerrada exitosamente")


@router.post(
    "/recuperar-password/solicitar",
    response_model=ApiResponse,
    summary="Solicitar enlace de recuperación de contraseña (RF-00.2)"
)
async def solicitar_recuperacion(
    data: SolicitarRecuperacionRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Genera un token de recuperación temporal filtrado por el subdominio del gimnasio.
    """
    await AuthService.solicitar_recuperacion_password(session, data)
    return ApiResponse(
        message="Si el correo ingresado se encuentra registrado en el gimnasio, recibirá un enlace de recuperación."
    )


@router.post(
    "/recuperar-password/confirmar",
    response_model=ApiResponse,
    summary="Confirmar y restablecer contraseña con token (RF-00.2)"
)
async def confirmar_recuperacion(
    data: ConfirmarRecuperacionRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Restablece la contraseña con hash Argon2id, quema el token, revoca sesiones previas
    y registra auditoría append-only.
    """
    await AuthService.confirmar_recuperacion_password(session, data)
    return ApiResponse(message="Contraseña restablecida exitosamente. Puede iniciar sesión con sus nuevas credenciales.")


@router.get(
    "/me",
    response_model=UsuarioAuthDto,
    summary="Obtener información y permisos canónicos del usuario en sesión"
)
async def get_me(
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Retorna el perfil del usuario autenticado con la lista canónica de capacidades.
    """
    return await AuthService.get_me(
        session=session,
        staff_id=current_staff.id,
        gym_id=current_staff.gimnasio_id,
        rol=current_staff.rol,
        nombre=current_staff.nombre,
        correo=current_staff.correo,
        subdominio=current_staff.subdominio
    )


@router.get(
    "/permisos/matriz",
    response_model=List[PermisoMatrizItemDto],
    summary="Consultar matriz completa de permisos (Solo Jefe - RF-00.5)",
    dependencies=[Depends(require_role("jefe"))]
)
async def get_matriz_permisos(
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Entrega la matriz de capacidades de recepcionistas y entrenadores del gimnasio actual.
    """
    return await AuthService.obtener_matriz_permisos(session, current_staff.gimnasio_id)


@router.put(
    "/permisos/matriz",
    response_model=List[PermisoMatrizItemDto],
    summary="Actualizar matriz de permisos (Solo Jefe - RF-00.5)",
    dependencies=[Depends(require_role("jefe"))]
)
async def update_matriz_permisos(
    data: ActualizarMatrizPermisosRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Modifica las capacidades por rol y submódulo de forma atómica y auditada.
    """
    return await AuthService.actualizar_matriz_permisos(
        session=session,
        gym_id=current_staff.gimnasio_id,
        actor_id=current_staff.id,
        actor_nombre=current_staff.nombre,
        data=data
    )
