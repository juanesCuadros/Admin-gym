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


class SalidaRequest(BaseModel):
    deportista_id: UUID = Field(..., description="UUID del deportista que registra su salida")


class SalidaResponseDto(BaseModel):
    checkin_id: int
    deportista_id: UUID
    deportista_nombre: str
    ingreso_ts: datetime
    salida_ts: datetime
    permanencia_minutos: int


class DeportistaAdentroItemDto(BaseModel):
    checkin_id: int
    deportista_id: UUID
    nombre: str
    documento: str
    ingreso_ts: datetime
    minutos_adentro: int


class DeportistasAdentroResponse(BaseModel):
    total: int
    items: List[DeportistaAdentroItemDto]


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
    salida_ts: Optional[datetime] = None
    permanencia_minutos: Optional[int] = None


class ResumenIngresosHoyDto(BaseModel):
    fecha: date
    total_ingresos: int
    accesos_abiertos: int
    alertas_mora: int
    accesos_negados: int
    cortesias: int
    adentro_ahora: int = 0


class ListadoIngresosHoyResponse(BaseModel):
    resumen: ResumenIngresosHoyDto
    items: List[CheckinItemHistorialDto]
