from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class SubdominioCheckPublico(BaseModel):
    subdominio_sugerido: str
    disponible: bool


class SignupRequest(BaseModel):
    nombre_gimnasio: str = Field(..., min_length=2, max_length=150)
    ciudad: str = Field(..., min_length=2, max_length=100)
    jefe_nombre: str = Field(..., min_length=2, max_length=150)
    jefe_correo: EmailStr
    telefono: str = Field(..., min_length=7, max_length=20)
    acepta_terminos: Literal[True] = Field(..., description="Debe ser true")


class MensajeResponse(BaseModel):
    mensaje: str


class SignupTokenInfo(BaseModel):
    valido: bool
    nombre_gimnasio: str
    subdominio_sugerido: str


class SignupConfirmRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class SignupConfirmResponse(BaseModel):
    subdominio: str
    url_login: str
