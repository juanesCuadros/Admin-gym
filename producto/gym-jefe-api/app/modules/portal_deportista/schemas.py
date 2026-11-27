import re
from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

PATRON_NOMBRE_VALIDO = re.compile(r"^[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\s\.\-']{2,120}$")
PATRON_TELEFONO_VALIDO = re.compile(r"^\+?[0-9\s\-\(\)]{7,20}$")


def validar_password_segura(password: str) -> str:
    """
    Valida que la contraseña cumpla estándares de alta seguridad:
    - Mínimo 8 caracteres, máximo 128.
    - Al menos una letra mayúscula.
    - Al menos una letra minúscula.
    - Al menos un número.
    - Al menos un carácter especial (@, #, $, !, %, *, ?, &, ., -, _, etc.).
    """
    if len(password) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres.")
    if len(password) > 128:
        raise ValueError("La contraseña no puede exceder los 128 caracteres.")
    if not re.search(r"[A-ZÁÉÍÓÚÑ]", password):
        raise ValueError("La contraseña debe incluir al menos una letra mayúscula.")
    if not re.search(r"[a-záéíóúñ]", password):
        raise ValueError("La contraseña debe incluir al menos una letra minúscula.")
    if not re.search(r"\d", password):
        raise ValueError("La contraseña debe incluir al menos un número.")
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?~`]", password):
        raise ValueError("La contraseña debe incluir al menos un carácter especial (ej. @, #, $, !, %, *).")
    return password


# =====================================================================
# 1. AUTENTICACIÓN Y ACTIVACIÓN POR PIN
# =====================================================================

class IniciarAccesoDeportistaRequest(BaseModel):
    correo: EmailStr = Field(..., description="Correo electrónico del deportista")
    subdominio: str = Field(..., min_length=2, max_length=63, description="Subdominio obligatorio del gimnasio")
    forzar_pin: bool = Field(
        False,
        description="Si es true, envía un nuevo código PIN incluso si el deportista ya tenía contraseña (recuperación/reenvío)",
    )

    @field_validator("correo")
    @classmethod
    def normalizar_correo(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("subdominio")
    @classmethod
    def normalizar_subdominio(cls, v: str) -> str:
        return v.strip().lower()


class IniciarAccesoDeportistaResponse(BaseModel):
    paso_siguiente: Literal["pin", "password"]
    correo: str
    mensaje: str
    vigencia_minutos: int = 15


class ValidarPinDeportistaRequest(BaseModel):
    correo: EmailStr = Field(..., description="Correo electrónico del deportista")
    pin: str = Field(..., min_length=6, max_length=6, description="Código PIN numérico de 6 dígitos")
    subdominio: str = Field(..., min_length=2, max_length=63, description="Subdominio obligatorio del gimnasio")

    @field_validator("correo")
    @classmethod
    def normalizar_correo(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("subdominio")
    @classmethod
    def normalizar_subdominio(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("pin")
    @classmethod
    def validar_formato_pin(cls, v: str) -> str:
        limpio = v.strip()
        if not re.match(r"^\d{6}$", limpio):
            raise ValueError("El código PIN debe contener exactamente 6 dígitos numéricos.")
        return limpio


class ValidarPinDeportistaResponse(BaseModel):
    valido: bool
    setup_token: str
    mensaje: str


class EstablecerPasswordDeportistaRequest(BaseModel):
    setup_token: str = Field(..., min_length=10, description="Token temporal emitido tras validar el PIN")
    password: str = Field(..., min_length=8, max_length=128, description="Nueva contraseña segura")
    password_confirmacion: str = Field(..., min_length=8, max_length=128, description="Confirmación de la contraseña")

    @field_validator("password")
    @classmethod
    def validar_fortaleza(cls, v: str) -> str:
        return validar_password_segura(v)

    @model_validator(mode="after")
    def verificar_coincidencia(self) -> "EstablecerPasswordDeportistaRequest":
        if self.password != self.password_confirmacion:
            raise ValueError("Las contraseñas no coinciden. Verifica que ambas sean idénticas.")
        return self


class LoginPasswordDeportistaRequest(BaseModel):
    correo: EmailStr
    password: str = Field(..., min_length=1, max_length=128)
    subdominio: str = Field(..., min_length=2, max_length=63, description="Subdominio obligatorio del gimnasio")

    @field_validator("correo")
    @classmethod
    def normalizar_correo(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("subdominio")
    @classmethod
    def normalizar_subdominio(cls, v: str) -> str:
        return v.strip().lower()


class DeportistaAuthPerfilDto(BaseModel):
    id: UUID
    cuenta_id: UUID
    gimnasio_id: UUID
    gimnasio_nombre: str
    subdominio: str
    nombre: str
    documento: str
    correo: str
    telefono: Optional[str] = None


class LoginDeportistaResponse(BaseModel):
    access_token: str
    deportista: DeportistaAuthPerfilDto


# =====================================================================
# 2. PERFIL Y MEMBRESÍA DEL DEPORTISTA
# =====================================================================

class MembresiaPortalResumenDto(BaseModel):
    id: UUID
    plan_nombre: str
    fecha_inicio: date
    fecha_vencimiento: date
    dias_restantes: int
    estado: str
    congelada: bool
    precio: Decimal


class PerfilDeportistaResponse(BaseModel):
    id: UUID
    gimnasio_nombre: str
    subdominio: str
    documento: str
    nombre: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    sexo: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    altura_cm: Optional[Decimal] = None
    acudiente_nombre: Optional[str] = None
    estado_general: str
    membresia_actual: Optional[MembresiaPortalResumenDto] = None
    total_asistencias_mes: int = 0
    total_asistencias_historico: int = 0
    ultimo_peso_kg: Optional[Decimal] = None
    ultimo_grasa_pct: Optional[Decimal] = None
    ultimo_masa_muscular_kg: Optional[Decimal] = None
    tiene_foto: bool = False
    version: int


class SubirFotoPerfilRequest(BaseModel):
    foto_base64: str = Field(..., min_length=20, max_length=9_000_000, description="Imagen en Base64 o Data URL")


class FotoPerfilResponse(BaseModel):
    tiene_foto: bool
    data_url: Optional[str] = None
    media_type: Optional[str] = None
    bytes_size: int = 0


class ActualizarPerfilDeportistaRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=120, description="Nombre completo del deportista")
    telefono: Optional[str] = Field(None, max_length=30, description="Teléfono de contacto")
    sexo: Optional[Literal["M", "F", "otro"]] = Field(None, description="Sexo biológico/antropométrico")
    fecha_nacimiento: Optional[date] = Field(None, description="Fecha de nacimiento")
    altura_cm: Optional[Decimal] = Field(None, ge=80, le=250, description="Estatura en centímetros")
    acudiente_nombre: Optional[str] = Field(None, max_length=120, description="Contacto de emergencia o acudiente")

    @field_validator("nombre", mode="before")
    @classmethod
    def validar_nombre(cls, v: str) -> str:
        if not v or not isinstance(v, str):
            raise ValueError("El nombre es obligatorio.")
        limpio = re.sub(r"\s+", " ", v.strip())
        if len(limpio) < 2:
            raise ValueError("El nombre debe tener al menos 2 caracteres.")
        if len(limpio) > 120:
            raise ValueError("El nombre no puede superar los 120 caracteres.")
        if not PATRON_NOMBRE_VALIDO.match(limpio) or not re.search(r"[a-zA-ZáéíóúñÁÉÍÓÚÑ]{2,}", limpio):
            raise ValueError("Ingresa un nombre válido usando únicamente letras y espacios.")
        return limpio

    @field_validator("telefono", mode="before")
    @classmethod
    def validar_telefono(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        limpio = str(v).strip()
        if not limpio:
            return None
        digitos = re.sub(r"\D", "", limpio)
        if len(digitos) < 7 or len(digitos) > 15 or not PATRON_TELEFONO_VALIDO.match(limpio):
            raise ValueError("Ingresa un teléfono válido de entre 7 y 15 dígitos.")
        return limpio

    @field_validator("acudiente_nombre", mode="before")
    @classmethod
    def validar_acudiente(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        limpio = re.sub(r"\s+", " ", str(v).strip())
        if not limpio:
            return None
        if len(limpio) < 2:
            raise ValueError("El nombre del contacto de emergencia debe tener al menos 2 caracteres.")
        return limpio


# =====================================================================
# 3. PAGOS Y COMPRAS (FINANZAS DEL DEPORTISTA)
# =====================================================================

class PagoMembresiaPortalItem(BaseModel):
    id: UUID
    membresia_id: Optional[UUID] = None
    plan_nombre: str
    monto: Decimal
    metodo: str
    dias_agregados: int = 0
    fecha_inicio: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    anulado: bool = False
    created_at: datetime


class CompraItemPortalDto(BaseModel):
    id: UUID
    tipo: str
    descripcion: str
    cantidad: int
    precio_unitario: Decimal
    subtotal: Decimal


class CompraTiendaPortalItem(BaseModel):
    id: UUID
    total: Decimal
    metodo: str
    anulada: bool
    created_at: datetime
    items: List[CompraItemPortalDto] = Field(default_factory=list)


class FinanzasDeportistaResponse(BaseModel):
    total_invertido_membresias: Decimal
    total_compras_tienda: Decimal
    cantidad_pagos_membresia: int
    cantidad_compras_tienda: int
    pagos_membresias: List[PagoMembresiaPortalItem]
    compras_tienda: List[CompraTiendaPortalItem]


# =====================================================================
# 4. MEDICIONES CORPORALES Y PROGRESO
# =====================================================================

class RegistrarMedicionPortalRequest(BaseModel):
    fecha: Optional[date] = Field(None, description="Fecha de la medición (por defecto hoy)")
    sexo: Optional[Literal["M", "F"]] = Field(None, description="Género para el cálculo antropométrico")
    altura_cm: Optional[Decimal] = Field(None, ge=80, le=250, description="Estatura base en cm")
    peso: Decimal = Field(..., ge=20, le=350, description="Peso corporal en kg")
    cintura: Optional[Decimal] = Field(None, ge=35, le=220, description="Perímetro de cintura en cm")
    cadera: Optional[Decimal] = Field(None, ge=40, le=230, description="Perímetro de cadera en cm")
    pecho: Optional[Decimal] = Field(None, ge=45, le=220, description="Perímetro de pecho en cm")
    brazo: Optional[Decimal] = Field(None, ge=15, le=80, description="Perímetro de brazo en cm")
    pierna: Optional[Decimal] = Field(None, ge=25, le=120, description="Perímetro de pierna en cm")


class MedicionPortalItem(BaseModel):
    id: UUID
    fecha: date
    peso: Optional[Decimal] = None
    imc: Optional[Decimal] = None
    grasa_pct: Optional[Decimal] = None
    masa_muscular: Optional[Decimal] = None
    cintura: Optional[Decimal] = None
    cadera: Optional[Decimal] = None
    pecho: Optional[Decimal] = None
    brazo: Optional[Decimal] = None
    pierna: Optional[Decimal] = None
    origen: Literal["deportista", "staff"]
    registrado_por_nombre: Optional[str] = None
    created_at: datetime


class ProgresoResumenDto(BaseModel):
    total_registros: int = 0
    peso_inicial: Optional[Decimal] = None
    peso_actual: Optional[Decimal] = None
    cambio_peso: Optional[Decimal] = None
    grasa_inicial: Optional[Decimal] = None
    grasa_actual: Optional[Decimal] = None
    cambio_grasa: Optional[Decimal] = None
    musculo_inicial: Optional[Decimal] = None
    musculo_actual: Optional[Decimal] = None
    cambio_musculo: Optional[Decimal] = None
    cintura_inicial: Optional[Decimal] = None
    cintura_actual: Optional[Decimal] = None
    cambio_cintura: Optional[Decimal] = None
    imc_actual: Optional[Decimal] = None
    altura_cm: Optional[Decimal] = None
    sexo: Optional[str] = None


class MedicionesPortalResponse(BaseModel):
    resumen: ProgresoResumenDto
    historial: List[MedicionPortalItem]


# =====================================================================
# 5. ASISTENCIAS DEL DEPORTISTA
# =====================================================================

class AsistenciaPortalItem(BaseModel):
    id: int
    fecha_hora: datetime
    fecha_local: str
    hora_local: str
    metodo: str
    resultado: str


class AsistenciasPortalResponse(BaseModel):
    asistencias_mes_actual: int
    asistencias_ultimos_30_dias: int
    asistencias_totales: int
    dias_asistidos_mes: List[str]
    historial: List[AsistenciaPortalItem]

