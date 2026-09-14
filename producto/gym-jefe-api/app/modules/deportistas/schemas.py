"""
Schemas Pydantic para el Módulo 4: Deportistas y Biometría (RF-17 a RF-23).
Incluye validaciones para Ley 1581, control de concurrencia optimista y DTOs de API.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


# =====================================================================
# 1. Registro y Edición de Deportistas (RF-17, RF-19)
# =====================================================================

class CrearDeportistaRequest(BaseModel):
    documento: str = Field(..., min_length=3, max_length=30, description="Cédula o documento único en el gimnasio")
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre completo del deportista")
    correo: Optional[EmailStr] = Field(None, description="Correo electrónico (puede repetirse en planes familiares/pareja)")
    telefono: Optional[str] = Field(None, max_length=25, description="Número de teléfono o celular")
    sexo: Optional[Literal["M", "F", "otro"]] = Field(None, description="Sexo del deportista")
    fecha_nacimiento: Optional[date] = Field(None, description="Fecha de nacimiento para cálculo de edad")
    altura_cm: Optional[Decimal] = Field(None, gt=0, max_digits=5, decimal_places=2, description="Estatura en centímetros")
    consentimiento_1581: bool = Field(..., description="Consentimiento explícito de tratamiento de datos bajo Ley 1581")
    acudiente_nombre: Optional[str] = Field(None, max_length=150, description="Nombre del acudiente (obligatorio si menor de 18 años)")

    @field_validator("documento", "nombre")
    @classmethod
    def strip_textos_obligatorios(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("El campo no puede estar compuesto únicamente por espacios.")
        return s

    @field_validator("telefono", "acudiente_nombre")
    @classmethod
    def strip_textos_opcionales(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            s = v.strip()
            return s if s else None
        return None

    @field_validator("consentimiento_1581")
    @classmethod
    def validar_consentimiento(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError(
                "El consentimiento de tratamiento de datos (Ley 1581) es obligatorio para completar el registro."
            )
        return v

    @model_validator(mode="after")
    def validar_menor_edad(self) -> "CrearDeportistaRequest":
        if self.fecha_nacimiento:
            today = date.today()
            age = (
                today.year
                - self.fecha_nacimiento.year
                - ((today.month, today.day) < (self.fecha_nacimiento.month, self.fecha_nacimiento.day))
            )
            if age < 18 and (not self.acudiente_nombre or not self.acudiente_nombre.strip()):
                raise ValueError("El nombre del acudiente es obligatorio para deportistas menores de 18 años.")
        return self


class EditarDeportistaRequest(BaseModel):
    version: int = Field(..., description="Versión actual esperada para control de concurrencia optimista")
    documento: Optional[str] = Field(None, min_length=3, max_length=30)
    nombre: Optional[str] = Field(None, min_length=2, max_length=150)
    correo: Optional[EmailStr] = None
    telefono: Optional[str] = Field(None, max_length=25)
    sexo: Optional[Literal["M", "F", "otro"]] = None
    fecha_nacimiento: Optional[date] = None
    altura_cm: Optional[Decimal] = Field(None, gt=0, max_digits=5, decimal_places=2)
    acudiente_nombre: Optional[str] = Field(None, max_length=150)

    @field_validator("documento", "nombre", "telefono", "acudiente_nombre")
    @classmethod
    def strip_opcionales(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            s = v.strip()
            return s if s else None
        return None

    @model_validator(mode="after")
    def validar_menor_edad_edicion(self) -> "EditarDeportistaRequest":
        if self.fecha_nacimiento:
            today = date.today()
            age = (
                today.year
                - self.fecha_nacimiento.year
                - ((today.month, today.day) < (self.fecha_nacimiento.month, self.fecha_nacimiento.day))
            )
            if age < 18 and (not self.acudiente_nombre or not self.acudiente_nombre.strip()):
                raise ValueError("El nombre del acudiente es obligatorio para deportistas menores de 18 años.")
        return self


class CambiarEstadoDeportistaRequest(BaseModel):
    activo: bool = Field(..., description="Nuevo estado operativo del deportista")


# =====================================================================
# 2. Respuestas de Deportistas
# =====================================================================

class DeportistaResponse(BaseModel):
    id: UUID
    gimnasio_id: UUID
    documento: str
    nombre: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    sexo: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    altura_cm: Optional[Decimal] = None
    consentimiento_1581: bool
    consentimiento_fecha: Optional[datetime] = None
    acudiente_nombre: Optional[str] = None
    activo: bool
    version: int
    created_at: datetime
    updated_at: datetime


class DeportistaResumenResponse(BaseModel):
    id: UUID
    documento: str
    nombre: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    activo: bool
    estado_membresia: str  # al_dia, por_vencer, en_mora, vencido, congelado, sin_membresia
    plan_nombre: Optional[str] = None
    fecha_vencimiento: Optional[date] = None
    version: int
    created_at: datetime


class DeportistasPaginadosResponse(BaseModel):
    items: List[DeportistaResumenResponse]
    total: int
    skip: int
    limit: int


class DeportistaBuscarResponse(BaseModel):
    id: UUID
    documento: str
    nombre: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    activo: bool
    estado_membresia: str


# =====================================================================
# 3. Ficha 360° del Deportista (RF-20)
# =====================================================================

class MembresiaFichaResponse(BaseModel):
    id: UUID
    plan_id: UUID
    plan_nombre: str
    fecha_inicio: date
    fecha_vencimiento: date
    cancelada: bool
    dias_restantes: int
    congelado: bool
    estado: str  # al_dia, por_vencer, en_mora, vencido, congelado


class PagoFichaResponse(BaseModel):
    id: UUID
    monto: Decimal
    metodo: str
    tipo_medio: str
    dias_agregados: int
    anulado: bool
    created_at: datetime


class AccesoFichaResponse(BaseModel):
    id: int
    tipo: str
    metodo: str
    resultado: str
    ts_bogota: datetime


class HuellaInfoResponse(BaseModel):
    id: UUID
    dedo: str
    created_at: datetime


class CuentaAppInfoResponse(BaseModel):
    id: Optional[UUID] = None
    correo: Optional[str] = None
    activa: bool = False
    ultimo_ingreso: Optional[datetime] = None
    invitacion_pendiente: bool = False
    invitacion_expira_en: Optional[datetime] = None


class FichaDeportistaResponse(BaseModel):
    deportista: DeportistaResponse
    membresia_actual: Optional[MembresiaFichaResponse] = None
    ultimos_pagos: List[PagoFichaResponse] = []
    ultimos_accesos: List[AccesoFichaResponse] = []
    mediciones_recientes: List["MedicionCorporalResponse"] = []
    huellas_enroladas: List[HuellaInfoResponse] = []
    cuenta_app: CuentaAppInfoResponse


# =====================================================================
# 4. Mediciones Corporales (RF-21)
# =====================================================================

class RegistrarMedicionRequest(BaseModel):
    fecha: Optional[date] = Field(None, description="Fecha de la toma (por defecto hoy)")
    peso: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Peso en kg")
    grasa_pct: Optional[Decimal] = Field(None, ge=0, le=100, max_digits=5, decimal_places=2, description="% de grasa")
    masa_muscular: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Masa muscular en kg")
    cintura: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Cintura en cm")
    cadera: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Cadera en cm")
    brazo: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Brazo en cm")
    pierna: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Pierna en cm")
    pecho: Optional[Decimal] = Field(None, gt=0, max_digits=6, decimal_places=2, description="Pecho en cm")

    @model_validator(mode="after")
    def validar_al_menos_una_metrica(self) -> "RegistrarMedicionRequest":
        metricas = [
            self.peso, self.grasa_pct, self.masa_muscular,
            self.cintura, self.cadera, self.brazo, self.pierna, self.pecho
        ]
        if all(m is None for m in metricas):
            raise ValueError("Debe registrar al menos una métrica corporal.")
        return self


class MedicionCorporalResponse(BaseModel):
    id: UUID
    fecha: date
    peso: Optional[Decimal] = None
    grasa_pct: Optional[Decimal] = None
    masa_muscular: Optional[Decimal] = None
    cintura: Optional[Decimal] = None
    cadera: Optional[Decimal] = None
    brazo: Optional[Decimal] = None
    pierna: Optional[Decimal] = None
    pecho: Optional[Decimal] = None
    registrado_por: Optional[UUID] = None
    registrado_por_nombre: Optional[str] = None
    created_at: datetime


# =====================================================================
# 5. Biometría de Huellas (RF-22, RNF-01)
# =====================================================================

class EnrolarHuellaRequest(BaseModel):
    dedo: str = Field(..., min_length=2, max_length=50, description="Identificador del dedo (ej. indice_derecho)")
    template_base64: str = Field(..., min_length=10, description="Plantilla biométrica binaria en Base64")

    @field_validator("dedo")
    @classmethod
    def normalizar_dedo(cls, v: str) -> str:
        s = v.strip().lower()
        if not s:
            raise ValueError("El identificador del dedo no puede estar vacío.")
        return s


# =====================================================================
# 6. Invitación App y Activación (RF-18)
# =====================================================================

class InvitacionAppResponse(BaseModel):
    deportista_id: UUID
    codigo: str
    enlace_activacion: str
    expira_en: datetime


# =====================================================================
# 7. Supresión de Datos / Derecho al Olvido (RF-23)
# =====================================================================

class SuprimirDatosRequest(BaseModel):
    motivo: str = Field(..., min_length=5, max_length=500, description="Motivo o número de radicado de la solicitud")
    confirmar: bool = Field(..., description="Confirmación explícita de la acción destructiva")

    @field_validator("confirmar")
    @classmethod
    def validar_confirmacion(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Debe confirmar explícitamente la supresión de datos.")
        return v
