"""
Schemas Pydantic para el Módulo 11: MyGymOS (Configuración del Gimnasio, RF-45 a RF-50).
Incluye:
- Concurrencia optimista (version)
- Parámetros operativos (RF-48)
- Información general y de contacto (RF-45)
- Métodos de pago (RF-47)
- Branding corporativo
- Landing y QR de solo lectura (RF-46)
- Consulta paginada de auditoría con filtros (RF-49, RF-50)
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


# ==============================================================================
# RF-48: PARÁMETROS OPERATIVOS
# ==============================================================================

class ActualizarParametrosRequest(BaseModel):
    version: int = Field(..., ge=1, description="Versión actual esperada para concurrencia optimista (OCC)")
    dias_gracia_mora: int = Field(
        ...,
        ge=0,
        le=30,
        description="Días tras vencimiento que el torniquete alerta pero permite paso [0..30]"
    )
    tope_dias_congelamiento: int = Field(
        ...,
        ge=0,
        le=365,
        description="Tope anual máximo de días acumulados de congelamiento por deportista [0..365]"
    )
    dias_umbral_por_vencer: int = Field(
        ...,
        ge=1,
        le=60,
        description="Días de anticipación para alertar membresía próxima a expirar [1..60]"
    )


class ParametrosTenantResponse(BaseModel):
    dias_gracia_mora: int
    tope_dias_congelamiento: int
    dias_umbral_por_vencer: int
    version: int


# ==============================================================================
# RF-45: INFORMACIÓN GENERAL Y CONTACTO
# ==============================================================================

class ActualizarInfoGymRequest(BaseModel):
    version: int = Field(..., ge=1, description="Versión actual esperada para concurrencia optimista (OCC)")
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre comercial del gimnasio")
    direccion: Optional[str] = Field(None, max_length=250, description="Dirección física de la sede")
    ciudad: Optional[str] = Field(None, max_length=100, description="Ciudad de ubicación")
    telefono: Optional[str] = Field(None, max_length=50, description="Teléfono o celular de contacto")
    correo: Optional[EmailStr] = Field(None, description="Correo electrónico oficial de contacto")
    redes: Optional[Dict[str, Optional[str]]] = Field(
        default_factory=dict,
        description="Redes sociales (instagram, facebook, whatsapp, etc.)"
    )
    horarios: Optional[Dict[str, str]] = Field(
        default_factory=dict,
        description="Horarios de atención por rangos (ej. lunes_viernes, sabados, domingos_festivos)"
    )


class InfoGymResponse(BaseModel):
    id: UUID
    nombre: str
    subdominio: str
    zona_horaria: str
    direccion: Optional[str] = None
    ciudad: Optional[str] = None
    telefono: Optional[str] = None
    correo: Optional[str] = None
    redes: Dict[str, Any] = Field(default_factory=dict)
    horarios: Optional[Dict[str, str]] = None
    metodos_pago: List[str] = Field(default_factory=list)
    dias_gracia_mora: int
    tope_dias_congelamiento: int
    dias_umbral_por_vencer: int
    branding: Dict[str, Any] = Field(default_factory=dict)
    version: int
    activo: bool
    updated_at: datetime


# ==============================================================================
# RF-47: MÉTODOS DE PAGO
# ==============================================================================

class ActualizarMetodosPagoRequest(BaseModel):
    version: int = Field(..., ge=1, description="Versión actual esperada para concurrencia optimista (OCC)")
    metodos_pago: List[str] = Field(
        ...,
        min_length=1,
        description="Lista de nombres de métodos de pago aceptados en caja (ej. efectivo, tarjeta, transferencia)"
    )


# ==============================================================================
# BRANDING E IDENTIDAD VISUAL
# ==============================================================================

class ActualizarBrandingRequest(BaseModel):
    version: int = Field(..., ge=1, description="Versión actual esperada para concurrencia optimista (OCC)")
    primary_color: Optional[str] = Field(None, max_length=30, description="Color primario en hex (ej. #4f46e5)")
    secondary_color: Optional[str] = Field(None, max_length=30, description="Color secundario en hex")
    accent_color: Optional[str] = Field(None, max_length=30, description="Color de acento en hex")
    logo_url: Optional[str] = Field(None, description="URL pública del logotipo corporativo")
    banner_url: Optional[str] = Field(None, description="URL pública del banner de sede")


# ==============================================================================
# RF-46: MI LANDING Y QR (SOLO LECTURA)
# ==============================================================================

class LandingInfoResponse(BaseModel):
    subdominio: str
    landing_slug: Optional[str] = None
    landing_url: str
    qr_data: str
    qr_svg: str
    es_solo_lectura: bool = True
    mensaje: str = (
        "El enlace público y el código QR son provisionados centralmente por la plataforma SaaS. "
        "Son de solo lectura para preservar la estabilidad de impresiones y enlaces físicos."
    )


# ==============================================================================
# RF-49 & RF-50: AUDITORÍA CON FILTROS (SOLO JEFE)
# ==============================================================================

class AuditoriaGymItemResponse(BaseModel):
    id: int
    created_at: datetime
    actor_id: Optional[UUID] = None
    actor_nombre: str
    impersonando: bool = False
    accion: str
    entidad: str
    entidad_id: Optional[str] = None
    detalle: Optional[Dict[str, Any]] = None
    hash_previo: Optional[str] = None
    hash_actual: str


class AuditoriaPaginadaResponse(BaseModel):
    items: List[AuditoriaGymItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AuditoriaFiltrosDisponiblesResponse(BaseModel):
    acciones: List[str]
    entidades: List[str]
