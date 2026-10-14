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


class DeportistaCheckinDto(BaseModel):
    id: UUID
    documento: str
    nombre: str
    estado: str  # desactivado, cancelado, sin_membresia, congelado, vencido, en_gracia, por_vencer, activo
    estado_calculado: Optional[str] = None
    dias_restantes_o_vencido: int

    def __init__(self, **data):
        if "estado" not in data and "estado_calculado" in data:
            data["estado"] = data["estado_calculado"]
        elif "estado_calculado" not in data and "estado" in data:
            data["estado_calculado"] = data["estado"]
        super().__init__(**data)


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
