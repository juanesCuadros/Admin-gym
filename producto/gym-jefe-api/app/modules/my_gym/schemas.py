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
import re
from typing import Any, Dict, List, Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

PATRON_NOMENCLATURA_DIRECCION = re.compile(
    r"\b(calle|cll|cl|carrera|cra|cr|kr|avenida|ave|av|diagonal|dg|transversal|tv|autopista|circular|circunvalar|manzana|mz|lote|km|kilometro|vereda|sede|edificio|torre|piso|local|centro comercial|cc|barrio|sector)\b",
    re.IGNORECASE,
)
PATRON_CARACTERES_DIRECCION = re.compile(r"^[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s\#\-\.\,\/\°\º]+$")
PATRON_CIUDAD = re.compile(r"^[a-zA-ZáéíóúñÁÉÍÓÚÑ\s\.\-]{3,100}$")
PATRON_TELEFONO = re.compile(r"^\+?[0-9\s\-\(\)]{7,20}$")
PATRON_WHATSAPP = re.compile(r"^\+?[0-9\s\-]{10,20}$")
PATRON_COLOR = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

def validar_direccion_sede(v: Optional[str]) -> Optional[str]:
    """
    Valida que la dirección de la sede tenga una longitud mínima (al menos 5 caracteres)
    y un formato coherente con nomenclatura vial y numeración (ej. 'Carrera 15 # 85-30').
    """
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    if len(val) < 5:
        raise ValueError("La dirección de la sede debe tener al menos 5 caracteres (ej. Carrera 15 # 85-30).")
    if len(val) > 250:
        raise ValueError("La dirección de la sede no puede exceder los 250 caracteres.")
    if not PATRON_CARACTERES_DIRECCION.match(val):
        raise ValueError("La dirección de la sede contiene caracteres no permitidos.")
    if val.isdigit():
        raise ValueError("La dirección de la sede no puede contener únicamente números.")
    sin_espacios = val.replace(" ", "")
    if len(set(sin_espacios)) <= 1:
        raise ValueError("La dirección de la sede debe ser una dirección válida y legible.")
    if not re.search(r"[a-zA-ZáéíóúñÁÉÍÓÚÑ]", val):
        raise ValueError("La dirección de la sede debe contener letras o nomenclatura vial.")
    tiene_numero = bool(re.search(r"\d", val))
    tiene_nomenclatura = bool(PATRON_NOMENCLATURA_DIRECCION.search(val))
    if not (tiene_numero or tiene_nomenclatura):
        raise ValueError("Ingresa un formato coherente de dirección con nomenclatura y numeración (ej. Carrera 15 # 85-30 o Calle 72 # 10-34).")
    return val

def validar_nombre_gym(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if len(val) < 2:
        raise ValueError("El nombre del gimnasio debe tener al menos 2 caracteres.")
    if len(val) > 150:
        raise ValueError("El nombre del gimnasio no puede superar los 150 caracteres.")
    if not re.search(r"[a-zA-ZáéíóúñÁÉÍÓÚÑ]", val):
        raise ValueError("El nombre del gimnasio debe contener letras.")
    return val

def validar_ciudad_gym(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    if len(val) < 3:
        raise ValueError("La ciudad debe tener al menos 3 caracteres (ej. Bogotá).")
    if len(val) > 100 or not PATRON_CIUDAD.match(val) or not re.search(r"[a-zA-ZáéíóúñÁÉÍÓÚÑ]", val):
        raise ValueError("Ingresa una ciudad válida con letras (ej. Bogotá, Medellín).")
    return val

def validar_telefono_gym(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    digitos = re.sub(r"\D", "", val)
    if len(digitos) < 7 or len(digitos) > 15 or not PATRON_TELEFONO.match(val):
        raise ValueError("Ingresa un teléfono válido de entre 7 y 15 dígitos (ej. +573001234567 o 6012345678).")
    return val

def validar_whatsapp_gym(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    digitos = re.sub(r"\D", "", val)
    if len(digitos) < 10 or len(digitos) > 15 or not PATRON_WHATSAPP.match(val):
        raise ValueError("Ingresa un número de WhatsApp válido de al menos 10 dígitos (ej. +573001234567).")
    return val

def validar_url_gym(v: Optional[str], campo: str = "La URL") -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    if len(val) < 8 or not val.lower().startswith(("http://", "https://")):
        raise ValueError(f"{campo} debe ser una dirección web válida que inicie con https:// o http://.")
    return val

def validar_red_social_gym(v: Optional[str], red: str = "red social") -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    if len(val) < 2:
        raise ValueError(f"Ingresa un usuario o enlace válido de {red}.")
    if val.lower().startswith(("http://", "https://")):
        return val
    limpio = val.lstrip("@")
    if not re.match(r"^[a-zA-Z0-9_\.]{2,50}$", limpio):
        raise ValueError(f"Ingresa un usuario válido de {red} (ej. @gimnasio).")
    return val

def validar_color_hex(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    val = v.strip()
    if not val:
        return None
    if not PATRON_COLOR.match(val):
        raise ValueError("El color debe estar en formato hexadecimal válido (ej. #4f46e5).")
    return val

def validar_redes_dict(redes: Optional[Dict[str, Optional[str]]]) -> Optional[Dict[str, Optional[str]]]:
    if not redes:
        return redes
    res = {}
    for k, v in redes.items():
        if v is None or not str(v).strip():
            res[k] = None
            continue
        val = str(v).strip()
        if k == "whatsapp":
            validar_whatsapp_gym(val)
        else:
            validar_red_social_gym(val, k.capitalize())
        res[k] = val
    return res


# ==============================================================================
# RF-48: PARÁMETROS OPERATIVOS
# ==============================================================================

class ActualizarParametrosRequest(BaseModel):
    version: int = Field(..., ge=1, description="Versión actual esperada para concurrencia optimista (OCC)")
    dias_gracia_mora: Optional[int] = Field(
        None,
        ge=0,
        le=30,
        description="Días tras vencimiento que el torniquete alerta pero permite paso [0..30]"
    )
    tope_dias_congelamiento: Optional[int] = Field(
        None,
        ge=0,
        le=365,
        description="Tope anual máximo de días acumulados de congelamiento por deportista [0..365]"
    )
    dias_umbral_por_vencer: Optional[int] = Field(
        None,
        ge=1,
        le=60,
        description="Días de anticipación para alertar membresía próxima a expirar [1..60]"
    )
    duracion_sesion_minutos: Optional[int] = Field(
        None,
        ge=15,
        le=480,
        description="Expiración de sesión por inactividad en minutos [15..480]. Si se omite, no cambia"
    )
    minimo_dias_congelamiento: Optional[int] = Field(
        None,
        ge=1,
        description="Mínimo de días por congelamiento [>=1]"
    )
    permitir_descuentos: Optional[bool] = Field(
        None,
        description="Habilitar la aplicación de descuentos"
    )
    tope_descuento_pct: Optional[int] = Field(
        None,
        ge=0,
        le=100,
        description="Tope máximo de descuento permitido [0..100%]"
    )
    ventana_reserva_dias: Optional[int] = Field(
        None,
        ge=0,
        description="Días de anticipación con que se permite reservar clases [>=0]"
    )
    limite_cancelar_reserva_horas: Optional[int] = Field(
        None,
        ge=0,
        description="Horas antes del inicio de la clase para cancelar la reserva [>=0]"
    )
    # Precio de los pases en COP enteros. Enviar null lo deja sin configurar (el punto de venta lo pide a mano).
    precio_pase_dia: Optional[int] = Field(None, ge=0, le=100_000_000, description="Precio del pase de día en COP")
    precio_pase_clase: Optional[int] = Field(None, ge=0, le=100_000_000, description="Precio del pase de clase en COP")

    @model_validator(mode="after")
    def validar_tope_y_minimo_congelamiento(self) -> "ActualizarParametrosRequest":
        if self.minimo_dias_congelamiento is not None and self.tope_dias_congelamiento is not None:
            if self.tope_dias_congelamiento < self.minimo_dias_congelamiento:
                raise ValueError("El tope de días de congelamiento debe ser mayor o igual al mínimo de días de congelamiento.")
        return self


class ParametrosTenantResponse(BaseModel):
    dias_gracia_mora: int
    tope_dias_congelamiento: int
    dias_umbral_por_vencer: int
    duracion_sesion_minutos: int
    minimo_dias_congelamiento: int = 1
    permitir_descuentos: bool = False
    tope_descuento_pct: int = 0
    ventana_reserva_dias: int = 7
    limite_cancelar_reserva_horas: int = 2
    precio_pase_dia: Optional[int] = None
    precio_pase_clase: Optional[int] = None
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

    @field_validator("nombre", mode="before")
    @classmethod
    def validar_campo_nombre(cls, v: str) -> str:
        return validar_nombre_gym(v)

    @field_validator("direccion", mode="before")
    @classmethod
    def validar_campo_direccion(cls, v: Optional[str]) -> Optional[str]:
        return validar_direccion_sede(v)

    @field_validator("ciudad", mode="before")
    @classmethod
    def validar_campo_ciudad(cls, v: Optional[str]) -> Optional[str]:
        return validar_ciudad_gym(v)

    @field_validator("telefono", mode="before")
    @classmethod
    def validar_campo_telefono(cls, v: Optional[str]) -> Optional[str]:
        return validar_telefono_gym(v)

    @field_validator("redes", mode="before")
    @classmethod
    def validar_campo_redes(cls, v: Optional[Dict[str, Optional[str]]]) -> Optional[Dict[str, Optional[str]]]:
        return validar_redes_dict(v)


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
    # GW-RF-48: expiración de sesión por inactividad (15 min – 8 h, por defecto 60)
    duracion_sesion_minutos: int
    minimo_dias_congelamiento: int = 1
    permitir_descuentos: bool = False
    tope_descuento_pct: int = 0
    ventana_reserva_dias: int = 7
    limite_cancelar_reserva_horas: int = 2
    precio_pase_dia: Optional[int] = None
    precio_pase_clase: Optional[int] = None
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

    @field_validator("primary_color", "secondary_color", "accent_color", mode="before")
    @classmethod
    def validar_campos_colores(cls, v: Optional[str]) -> Optional[str]:
        return validar_color_hex(v)

    @field_validator("logo_url", mode="before")
    @classmethod
    def validar_campo_logo_url(cls, v: Optional[str]) -> Optional[str]:
        return validar_url_gym(v, "El logo")

    @field_validator("banner_url", mode="before")
    @classmethod
    def validar_campo_banner_url(cls, v: Optional[str]) -> Optional[str]:
        return validar_url_gym(v, "El banner")


class PublicBrandingResponse(BaseModel):
    nombre: str
    subdominio: str
    logo_url: Optional[str] = None
    primary_color: str
    secondary_color: str
    accent_color: str


# ==============================================================================
# GW-RF-51: ESTADO DE LA SUSCRIPCIÓN DEL GIMNASIO (calculado en cada consulta)
# ==============================================================================

class EstadoSuscripcionResponse(BaseModel):
    """
    Estado calculado según §2.2 de los requisitos del Super-Admin. No expone el valor de la
    mensualidad ni la deuda: eso es entre MVC y el dueño.
    """
    estado_calculado: str = Field(..., description="al_dia | por_vencer | en_gracia | bloqueado")
    dias_restantes: Optional[int] = Field(
        None, description="Días hasta el corte; negativo si ya pasó. null si el gimnasio no tiene fecha de corte"
    )
    motivo_bloqueo: Optional[str] = Field(
        None, description="falta_pago | suspendido | cancelado | prueba_vencida | null"
    )


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


# ==============================================================================
# CONTRATO 2.6: MI SUSCRIPCIÓN (PLANES DEL SAAS)
# ==============================================================================

class PlanActualDetalle(BaseModel):
    codigo: str
    nombre: str
    tipo: str
    max_clientes_activos: Optional[int] = None
    max_staff: Optional[int] = None


class UsoTenantDetalle(BaseModel):
    clientes_activos: int
    staff: int


class SolicitudPlanPendienteDetalle(BaseModel):
    id: UUID
    plan_nombre: str
    solicitado_por: str
    created_at: datetime


class PlanSuscripcionResponse(BaseModel):
    plan_actual: Optional[PlanActualDetalle] = None
    uso: UsoTenantDetalle
    solicitud_pendiente: Optional[SolicitudPlanPendienteDetalle] = None


class PlanDisponibleItem(BaseModel):
    id: UUID
    codigo: str
    nombre: str
    descripcion: Optional[str] = None
    precio: int
    duracion_meses: int
    max_clientes_activos: Optional[int] = None
    max_staff: Optional[int] = None


class CrearSolicitudPlanRequest(BaseModel):
    plan_id: UUID
    nota: Optional[str] = None


class SolicitudPlanCreadaResponse(BaseModel):
    id: UUID


class MensajeAccionResponse(BaseModel):
    mensaje: str

