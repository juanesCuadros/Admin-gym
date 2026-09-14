"""Schemas Pydantic para el módulo personal (RF-39, RF-40)"""
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field


RolStaff = Literal["recepcionista", "entrenador"]
RolStaffTransferencia = Literal["recepcionista", "entrenador"]


class CrearStaffRequest(BaseModel):
    """Payload para registrar un nuevo miembro del staff (RF-39)."""
    nombre: str = Field(..., min_length=2, max_length=100, description="Nombre completo del miembro del personal")
    correo: EmailStr = Field(..., description="Correo electrónico único dentro del gimnasio")
    password: str = Field(..., min_length=8, max_length=100, description="Contraseña inicial (mínimo 8 caracteres)")
    rol: RolStaff = Field(..., description="Rol operativo asignado: recepcionista o entrenador")


class ActualizarStaffRequest(BaseModel):
    """Payload para actualizar datos de un miembro del staff con concurrencia optimista."""
    nombre: str = Field(..., min_length=2, max_length=100, description="Nombre completo")
    correo: EmailStr = Field(..., description="Correo electrónico único dentro del gimnasio")
    rol: RolStaff = Field(..., description="Rol operativo: recepcionista o entrenador")
    version: int = Field(..., ge=1, description="Versión esperada del registro para control de concurrencia optimista")


class CambiarEstadoStaffRequest(BaseModel):
    """Payload para activar o desactivar un miembro del staff (RF-39)."""
    activo: bool = Field(..., description="Nuevo estado del usuario (true=activo, false=desactivado)")
    motivo: Optional[str] = Field(None, max_length=255, description="Motivo opcional del cambio de estado")


class TransferirJefeRequest(BaseModel):
    """Payload para transferir el rol de Jefe a otro miembro del staff (RF-40)."""
    nuevo_jefe_id: UUID = Field(..., description="ID del miembro del staff que asumirá el rol de Jefe")
    nuevo_rol_antiguo_jefe: RolStaffTransferencia = Field(
        ...,
        description="Nuevo rol operativo que asumirá el Jefe saliente (recepcionista o entrenador)"
    )
    password_confirmacion: str = Field(
        ...,
        min_length=1,
        description="Contraseña del Jefe actual para confirmar la transferencia irreversible del rol"
    )


class StaffResponse(BaseModel):
    """Representación pública de un miembro del personal."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: UUID
    nombre: str
    correo: str
    rol: str
    activo: bool
    ultimo_ingreso: Optional[datetime] = None
    version: int
    created_at: datetime
    updated_at: datetime


class StaffListResponse(BaseModel):
    """Respuesta paginada del listado de personal."""
    items: List[StaffResponse]
    total: int
    pagina: int
    limite: int
    total_paginas: int


class CambiarEstadoStaffResponse(BaseModel):
    """Respuesta al cambiar el estado activo de un miembro del staff."""
    id: UUID
    nombre: str
    activo: bool
    turno_cerrado_forzado: bool = Field(
        False,
        description="Indica si se ejecutó un cierre forzado automático de turno de caja abierto (RF-39)"
    )
    turno_id_cerrado: Optional[UUID] = Field(
        None,
        description="ID del turno de caja que fue cerrado forzadamente, si aplicó"
    )
    mensaje: str


class TransferirJefeResponse(BaseModel):
    """Respuesta a la transferencia de rol de Jefe (RF-40)."""
    antiguo_jefe_id: UUID
    antiguo_jefe_nuevo_rol: str
    nuevo_jefe_id: UUID
    nuevo_jefe_nombre: str
    mensaje: str
