"""Turno de trabajo: entrada, salida y horas del personal. No tiene que ver con la caja."""
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class TurnoTrabajoItem(BaseModel):
    id: UUID
    staff_id: UUID
    staff_nombre: str
    staff_rol: str
    entrada_en: datetime
    salida_en: Optional[datetime] = None
    # None mientras el turno siga abierto: las horas se cuentan al cerrarlo.
    minutos: Optional[int] = None
    cerrado_por_nombre: Optional[str] = None
    motivo_cierre: Optional[str] = None


class MiTurnoResponse(BaseModel):
    abierto: Optional[TurnoTrabajoItem] = None
    minutos_hoy: int = Field(0, description="Minutos de los turnos ya cerrados que empezaron hoy")


class ResumenPersona(BaseModel):
    staff_id: UUID
    staff_nombre: str
    minutos: int
    turnos: int
    abiertos: int


class ListadoTurnosTrabajoResponse(BaseModel):
    desde: date
    hasta: date
    items: List[TurnoTrabajoItem]
    total: int
    resumen: List[ResumenPersona]


class CerrarTurnoAjenoRequest(BaseModel):
    salida_en: datetime = Field(..., description="Hora real de salida, con zona horaria")
    motivo: str = Field(..., min_length=4, max_length=255, description="Por qué lo cierra el Jefe")
