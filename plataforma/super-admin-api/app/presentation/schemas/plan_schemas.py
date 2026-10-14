from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class PlanBase(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=120)
    descripcion: Optional[str] = Field(None, max_length=500)
    precio: int = Field(0, ge=0, description="Precio mensual en COP enteros")
    duracion_meses: Optional[int] = Field(None, ge=1, le=36, description="Solo planes de pago")
    dias_prueba: Optional[int] = Field(None, ge=1, le=90, description="Solo el plan de prueba")
    max_clientes_activos: Optional[int] = Field(None, ge=1, description="NULL = sin límite")
    max_staff: Optional[int] = Field(None, ge=1, description="NULL = sin límite")
    publico: bool = True
    orden: int = 0


class PlanCreate(PlanBase):
    codigo: str = Field(..., pattern=r"^[a-z0-9_]{2,40}$")
    tipo: str = Field(..., pattern="^(prueba|pago)$")
    activo: bool = True


class PlanUpdate(PlanBase):
    """`codigo` y `tipo` no se editan: si llegan, la API responde 422 CAMPO_NO_EDITABLE."""
    version: int = Field(..., ge=1)
    codigo: Optional[str] = None
    tipo: Optional[str] = None


class PlanStatusUpdate(BaseModel):
    activo: bool


class PlanResponse(BaseModel):
    id: str
    codigo: str
    nombre: str
    descripcion: Optional[str] = None
    tipo: str
    precio: int
    duracion_meses: Optional[int] = None
    dias_prueba: Optional[int] = None
    max_clientes_activos: Optional[int] = None
    max_staff: Optional[int] = None
    activo: bool
    publico: bool
    orden: int
    version: int
    gimnasios_actuales: int = 0


class PlanPublicoResponse(BaseModel):
    id: str
    codigo: str
    nombre: str
    descripcion: Optional[str] = None
    tipo: str
    precio: int
    duracion_meses: Optional[int] = None
    dias_prueba: Optional[int] = None
    max_clientes_activos: Optional[int] = None
    max_staff: Optional[int] = None


class CambioPlanRequest(BaseModel):
    plan_id: str
    vigente_desde: Optional[date] = Field(None, description="Por defecto, hoy (Bogotá)")


class CambioPlanResponse(BaseModel):
    gimnasio_id: str
    plan_id: str
    plan_nombre: str
    suscripcion_id: str
    valor_mensual: int
    vigente_desde: date
