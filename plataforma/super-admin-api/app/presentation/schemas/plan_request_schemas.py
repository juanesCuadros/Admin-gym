from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.core.fechas import hoy_bogota


class GimnasioResumen(BaseModel):
    id: str
    nombre: str
    subdominio: str


class PlanResumen(BaseModel):
    id: str
    nombre: str
    precio: int
    duracion_meses: Optional[int] = None


class SolicitudPlanResponse(BaseModel):
    id: str
    gimnasio: GimnasioResumen
    plan: PlanResumen
    solicitado_por: str
    nota: Optional[str] = None
    created_at: datetime
    estado: str
    motivo_rechazo: Optional[str] = None
    resuelta_en: Optional[datetime] = None


class AprobarSolicitudRequest(BaseModel):
    monto: int = Field(..., gt=0, description="COP enteros")
    fecha_pago: date = Field(default_factory=hoy_bogota)
    metodo: str = Field(..., min_length=2, max_length=100)
    nota: Optional[str] = Field(None, max_length=500)


class RechazarSolicitudRequest(BaseModel):
    motivo: str = Field(..., min_length=5, max_length=500)


class AprobacionResponse(BaseModel):
    solicitud_id: str
    estado: str
    pago_id: str
    monto: int
    meses: int
    fecha_pago: date
    plan_id: str
    plan_nombre: str
    suscripcion_id: str
    nueva_fecha_corte: Optional[date] = None
    estado_gimnasio: str
    aviso_monto: Optional[str] = None  # SA-RF-16 CA5: no bloquea
