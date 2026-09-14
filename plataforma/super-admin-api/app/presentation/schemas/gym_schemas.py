from datetime import date, datetime
from typing import Optional, List, Dict, Any
from decimal import Decimal
from pydantic import BaseModel, EmailStr, Field

class JefeAccountCreate(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=150)
    correo: EmailStr
    telefono: Optional[str] = Field(None, max_length=50)

class SubscriptionCreate(BaseModel):
    valor_mensual: Decimal = Field(..., ge=0, description="Monto mensual acordado")
    tipo_inicio: str = Field(..., pattern="^(prueba|cliente_activo)$", description="'prueba' (5 días) o 'cliente_activo'")

class GymCreateStepByStep(BaseModel):
    # Paso 1: Identidad
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre del gimnasio")
    subdominio: Optional[str] = Field(None, description="Subdominio sugerido; si es nulo se autogenera del nombre")
    nit: Optional[str] = Field(None, max_length=50)
    direccion: Optional[str] = Field(None, max_length=255)
    ciudad: Optional[str] = Field(None, max_length=100)
    telefono: Optional[str] = Field(None, max_length=50)
    correo: Optional[EmailStr] = None

    # Paso 2: Imagen pública
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    descripcion: Optional[str] = Field(None, max_length=300)
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    whatsapp: Optional[str] = None

    # Paso 3: Cuenta del Jefe
    jefe: JefeAccountCreate

    # Paso 4: Suscripción
    suscripcion: SubscriptionCreate

class GymUpdate(BaseModel):
    # Subdominio is immutable (RF-08)
    nombre: Optional[str] = Field(None, min_length=2, max_length=150)
    nit: Optional[str] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    correo: Optional[EmailStr] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    descripcion: Optional[str] = Field(None, max_length=300)
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    whatsapp: Optional[str] = None

class GymStateChangeRequest(BaseModel):
    nuevo_estado: str = Field(..., pattern="^(prueba|activo|suspendido|cancelado)$")
    motivo: Optional[str] = Field(None, description="Requerido si el nuevo estado es cancelado")

class GymCancelRequest(BaseModel):
    motivo: str = Field(..., min_length=5, description="Motivo formal de la cancelación (RF-10)")

class SubdomainCheckResponse(BaseModel):
    subdominio: str
    disponible: bool
    valido: bool
    mensaje: str

class JefeResponse(BaseModel):
    id: str
    nombre: str
    correo: str
    telefono: Optional[str] = None
    password_cambiada: bool
    ultimo_ingreso: Optional[datetime] = None

class SubscriptionResponse(BaseModel):
    id: str
    valor_mensual: float
    tipo_inicio: str
    vigente_desde: date
    vigente_hasta: Optional[date] = None

class GymListItemResponse(BaseModel):
    id: str
    gimnasio_id: str
    nombre: str
    subdominio: str
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    estado: str
    fecha_inicio: date
    fecha_corte: Optional[date] = None
    dias_restantes: Optional[int] = None
    logo_url: Optional[str] = None
    jefe_nombre: Optional[str] = None
    jefe_correo: Optional[str] = None
    valor_mensual: Optional[float] = None
    created_at: datetime

from app.presentation.schemas.payment_schemas import PaymentResponse
from app.presentation.schemas.audit_schemas import AuditLogResponse

class GymDetailResponse(BaseModel):
    id: str
    gimnasio_id: str
    nombre: str
    subdominio: str
    url_acceso: str
    nit: Optional[str] = None
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    correo: Optional[str] = None
    estado: str
    fecha_inicio: date
    fecha_corte: Optional[date] = None
    dias_restantes: Optional[int] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    descripcion: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    whatsapp: Optional[str] = None
    motivo_cancelacion: Optional[str] = None
    fecha_cancelacion: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    cuenta_jefe: Optional[JefeResponse] = None
    suscripcion_actual: Optional[SubscriptionResponse] = None
    suscripciones_historial: List[SubscriptionResponse] = []
    total_pagos_registrados: int = 0
    historial_pagos: List[PaymentResponse] = []
    actividad_reciente: List[AuditLogResponse] = []

class CredentialsIssuanceResponse(BaseModel):
    gimnasio_id: str
    gimnasio_nombre: str
    correo_jefe: str
    url_acceso: str
    password_temporal: str
    expira_en: datetime
    tipo: str  # emitida, regenerada, reenviada
    whatsapp_copiable: str
    mensaje: str = "Credenciales generadas con éxito. Por seguridad, la contraseña temporal se muestra una sola vez."
