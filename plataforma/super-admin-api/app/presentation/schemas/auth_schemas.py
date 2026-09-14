from datetime import datetime
from typing import Optional, Union
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field

class LoginRequest(BaseModel):
    correo: EmailStr = Field(..., description="Correo del usuario interno MVC")
    password: str = Field(..., min_length=6, description="Contraseña")

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int
    usuario: "UsuarioInternoResponse"

class UsuarioInternoResponse(BaseModel):
    id: Union[str, UUID]
    nombre: str
    correo: str
    rol: str
    activo: bool
    ultimo_ingreso: Optional[datetime] = None

class PasswordRecoveryRequest(BaseModel):
    correo: EmailStr

class PasswordResetRequest(BaseModel):
    token: str
    nueva_password: str = Field(..., min_length=8)

class MessageResponse(BaseModel):
    mensaje: str
    exito: bool = True
