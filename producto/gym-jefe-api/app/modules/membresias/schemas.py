"""
Schemas Pydantic para el Módulo 5: Membresías y Planes (RF-24 a RF-27, RF-42).
Incluye DTOs para catálogo de planes con versionado optimista, ciclo de vida de membresías,
cambio de plan sin prorrateo y congelamiento/descongelamiento con tope de días.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field, field_validator


# =============================================================================
# 1. CATÁLOGO DE PLANES (RF-24)
# =============================================================================

class CrearPlanRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=100, description="Nombre del plan (único por gimnasio)")
    precio: Decimal = Field(..., ge=0, description="Precio en moneda local")
    duracion_dias: int = Field(..., gt=0, description="Duración en días del plan")
    tipo: Literal["individual", "pareja", "familiar"] = Field(
        ..., description="Modalidad del plan: individual, pareja o familiar"
    )
    cupo_personas: int = Field(1, ge=1, description="Cantidad máxima de beneficiarios")

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("El nombre del plan no puede estar vacío.")
        return s


class EditarPlanRequest(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=100)
    precio: Optional[Decimal] = Field(None, ge=0)
    duracion_dias: Optional[int] = Field(None, gt=0)
    tipo: Optional[Literal["individual", "pareja", "familiar"]] = None
    cupo_personas: Optional[int] = Field(None, ge=1)
    version: int = Field(..., description="Versión esperada para control de concurrencia optimista")


class CambiarEstadoPlanRequest(BaseModel):
    activo: bool = Field(..., description="Nuevo estado del plan (true=activo, false=inactivo)")


class PlanResponse(BaseModel):
    id: UUID
    gimnasio_id: UUID
    nombre: str
    precio: Decimal
    duracion_dias: int
    tipo: str
    cupo_personas: int
    activo: bool
    version: int
    created_at: datetime
    updated_at: datetime


class PlanesListResponse(BaseModel):
    items: List[PlanResponse]
    total: int


# =============================================================================
# 2. GESTIÓN DE MEMBRESÍAS Y CICLO DE VIDA (RF-25, RF-27, RF-42)
# =============================================================================

class AsignarMembresiaRequest(BaseModel):
    deportista_id: UUID = Field(..., description="UUID del deportista que recibe la membresía")
    plan_id: UUID = Field(..., description="UUID del plan tarifario a asignar")
    fecha_inicio: Optional[date] = Field(None, description="Fecha de inicio (default hoy local)")


class CambiarPlanRequest(BaseModel):
    nuevo_plan_id: UUID = Field(..., description="UUID del nuevo plan a contratar")
    motivo: Optional[str] = Field(None, max_length=255, description="Motivo opcional del cambio de plan")


class CancelarMembresiaRequest(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255, description="Motivo obligatorio de la cancelación")


class CongelarMembresiaRequest(BaseModel):
    motivo: Optional[str] = Field(None, max_length=255, description="Motivo opcional del congelamiento")


class MembresiaResponse(BaseModel):
    id: UUID
    gimnasio_id: UUID
    deportista_id: UUID
    plan_id: UUID
    plan_nombre: str
    fecha_inicio: date
    fecha_vencimiento: date
    cancelada: bool
    estado_calculado: str
    dias_restantes_o_vencido: int
    congelamiento_activo: bool
    congelamiento_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class MembresiaListItemResponse(BaseModel):
    id: UUID
    deportista_id: UUID
    deportista_nombre: str
    deportista_documento: str
    deportista_correo: Optional[str] = None
    deportista_telefono: Optional[str] = None
    plan_id: UUID
    plan_nombre: str
    fecha_inicio: date
    fecha_vencimiento: date
    cancelada: bool
    estado_calculado: str
    dias_restantes_o_vencido: int
    congelamiento_activo: bool
    congelamiento_id: Optional[UUID] = None


class MembresiasPaginadasResponse(BaseModel):
    items: List[MembresiaListItemResponse]
    total: int
    skip: int
    limit: int


class CongelamientoItemResponse(BaseModel):
    id: UUID
    fecha_inicio: date
    fecha_fin: Optional[date] = None
    dias: Optional[int] = None
    vigente: bool
    registrado_por_nombre: Optional[str] = None
    created_at: datetime


class FichaMembresiaResponse(BaseModel):
    membresia: MembresiaResponse
    congelamientos: List[CongelamientoItemResponse]
    pagos: List[Dict[str, Any]]
