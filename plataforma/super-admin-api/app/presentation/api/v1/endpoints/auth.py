from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.dependencies import get_current_admin_user
from app.application.use_cases.auth_use_cases import AuthUseCases
from app.presentation.schemas.auth_schemas import (
    LoginRequest, TokenResponse, UsuarioInternoResponse,
    PasswordRecoveryRequest, PasswordResetRequest, MessageResponse
)
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["Autenticación"])

@router.post("/login", response_model=TokenResponse, summary="Iniciar sesión de usuario MVC")
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """
    RF-00.1 / RF-00.4: Inicia sesión con correo y contraseña.
    Bloquea temporalmente tras varios intentos fallidos en la ventana de tiempo.
    """
    client_ip = request.client.host if request.client else None
    use_cases = AuthUseCases(db)
    token, user = use_cases.login(correo=data.correo, password=data.password, client_ip=client_ip)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        usuario=UsuarioInternoResponse(
            id=str(user.id),
            nombre=user.nombre,
            correo=user.correo,
            rol=user.rol,
            activo=user.activo,
            ultimo_ingreso=user.ultimo_ingreso
        )
    )

@router.post("/recovery", response_model=MessageResponse, summary="Solicitar recuperación de contraseña")
def recover_password(data: PasswordRecoveryRequest, db: Session = Depends(get_db)):
    """
    RF-00.2: Genera un token de recuperación y simula el envío del enlace de restablecimiento.
    """
    use_cases = AuthUseCases(db)
    use_cases.request_password_recovery(data.correo)
    return MessageResponse(mensaje="Si el correo existe, se enviará un enlace de recuperación.")

@router.post("/reset-password", response_model=MessageResponse, summary="Restablecer contraseña con token")
def reset_password(data: PasswordResetRequest, db: Session = Depends(get_db)):
    """
    RF-00.2: Restablece la contraseña de un usuario mediante token válido.
    """
    use_cases = AuthUseCases(db)
    use_cases.reset_password(raw_token=data.token, nueva_password=data.nueva_password)
    return MessageResponse(mensaje="Contraseña actualizada exitosamente.")

@router.get("/me", response_model=UsuarioInternoResponse, summary="Obtener perfil del usuario actual")
def read_users_me(user = Depends(get_current_admin_user)):
    """Devuelve la información del usuario interno autenticado."""
    return UsuarioInternoResponse(
        id=str(user.id),
        nombre=user.nombre,
        correo=user.correo,
        rol=user.rol,
        activo=user.activo,
        ultimo_ingreso=user.ultimo_ingreso
    )

@router.post("/logout", response_model=MessageResponse, summary="Cerrar sesión de usuario (RF-00.3)")
def logout(
    credentials = Depends(get_current_admin_user),
    db: Session = Depends(get_db),
    request: Request = None
):
    """
    RF-00.3: Cierra la sesión activa revocando de inmediato el token de acceso JWT.
    """
    auth_header = request.headers.get("Authorization") if request else None
    token = ""
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
    
    use_cases = AuthUseCases(db)
    use_cases.logout(token=token, user=credentials)
    return MessageResponse(mensaje="Sesión cerrada exitosamente y token revocado.")

