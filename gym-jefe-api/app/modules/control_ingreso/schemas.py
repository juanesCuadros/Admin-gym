from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


# --- Requests ---
class CheckinManualRequest(BaseModel):
    deportista_id: Optional[UUID] = Field(None, description="UUID del deportista")
    documento: Optional[str] = Field(None, description="Documento de identidad (si no se envía UUID)")


class CheckinHuellaRequest(BaseModel):
    deportista_id: UUID = Field(..., description="UUID del deportista reconocido por el lector biométrico")


class IngresoCortesiaRequest(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255, description="Motivo obligatorio del ingreso de cortesía")


# --- Responses ---
class DeportistaCheckinDto(BaseModel):
    id: UUID
    documento: str
    nombre: str
    estado_calculado: str  # activo, por_vencer, mora, vencido, congelado, cancelada, inactivo, sin_membresia
    dias_restantes_o_vencido: int


class CheckinResponseDto(BaseModel):
    checkin_id: Optional[int] = None
    tipo: str  # ingreso | cortesia
    metodo: str  # manual | huella
    resultado: str  # abrio | alerta_mora | negado
    comando_torniquete: bool
    mensaje: str
    relectura_ignorada: bool = False
    deportista: Optional[DeportistaCheckinDto] = None
    ts_local: datetime


class CheckinItemHistorialDto(BaseModel):
    id: int
    tipo: str
    metodo: str
    resultado: str
    motivo_cortesia: Optional[str] = None
    deportista_id: Optional[UUID] = None
    deportista_nombre: Optional[str] = None
    deportista_documento: Optional[str] = None
    registrado_por_nombre: Optional[str] = None
    ts_local: datetime


class ResumenIngresosHoyDto(BaseModel):
    fecha: date
    total_ingresos: int
    accesos_abiertos: int
    alertas_mora: int
    accesos_negados: int
    cortesias: int


class ListadoIngresosHoyResponse(BaseModel):
    resumen: ResumenIngresosHoyDto
    items: List[CheckinItemHistorialDto]
