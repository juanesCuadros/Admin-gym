from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


# --- Schemas de Entrada (Requests) ---
class LoginRequest(BaseModel):
    subdominio: str = Field(
        ...,
        min_length=2,
        max_length=50,
        pattern=r"^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$",
        description="Subdominio único del gimnasio (tenant)"
    )
    correo: EmailStr = Field(..., description="Correo corporativo del staff en este gimnasio")
    password: str = Field(..., min_length=1, description="Contraseña de acceso")


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=10, description="Token de refresco")


class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=10, description="Token de refresco a revocar")


class SolicitarRecuperacionRequest(BaseModel):
    subdominio: str = Field(
        ...,
        min_length=2,
        max_length=50,
        pattern=r"^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$",
        description="Subdominio del gimnasio al que pertenece la cuenta"
    )
    correo: EmailStr = Field(..., description="Correo del usuario para recibir enlace de recuperación")


class ConfirmarRecuperacionRequest(BaseModel):
    token: str = Field(..., min_length=10, description="Token temporal de recuperación recibido")
    nueva_password: str = Field(..., min_length=8, description="Nueva contraseña (mínimo 8 caracteres)")


class PermisoItemUpdate(BaseModel):
    rol: str = Field(..., pattern="^(recepcionista|entrenador)$", description="Rol subordinado a configurar")
    submodulo: str = Field(..., description="Identificador del submódulo")
    puede_crear: bool
    puede_leer: bool
    puede_editar: bool
    puede_eliminar: bool


class ActualizarMatrizPermisosRequest(BaseModel):
    permisos: List[PermisoItemUpdate]


# --- Schemas de Salida (Responses) ---
class UsuarioAuthDto(BaseModel):
    id: UUID
    nombre: str
    correo: str
    rol: str
    gimnasio_id: UUID
    subdominio: str
    permisos: List[str]  # ["*"] para Jefe, o ["submodulo:accion"] canónico (leer, crear, editar, eliminar)


class LoginResponseDto(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    usuario: UsuarioAuthDto


class RefreshResponseDto(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: UsuarioAuthDto


class PermisoMatrizItemDto(BaseModel):
    rol: str
    submodulo: str
    puede_crear: bool
    puede_leer: bool
    puede_editar: bool
    puede_eliminar: bool


class ApiResponse(BaseModel):
    success: bool = True
    message: str
    data: Optional[Any] = None
