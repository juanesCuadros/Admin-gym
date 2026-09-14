from datetime import date, datetime
from typing import Optional
from decimal import Decimal
from pydantic import BaseModel, Field

class PaymentCreate(BaseModel):
    monto: Decimal = Field(..., gt=0, description="Monto del pago en COP/USD")
    meses: int = Field(..., gt=0, le=36, description="Cantidad de meses que cubre este pago")
    fecha_pago: Optional[date] = Field(default_factory=date.today, description="Fecha efectiva del pago")
    metodo: str = Field(..., min_length=2, max_length=100, description="Método de pago (texto libre, ej: Transferencia Bancolombia, Nequi, Efectivo)")
    nota: Optional[str] = Field(None, description="Observaciones o notas adicionales")
    idempotency_key: str = Field(..., min_length=10, max_length=100, description="Clave única generada por el cliente para evitar pagos duplicados (RNF-04)")

class PaymentVoidRequest(BaseModel):
    motivo_anulacion: str = Field(..., min_length=5, description="Motivo obligatorio de la anulación (RF-18)")

class PaymentResponse(BaseModel):
    id: str
    gimnasio_id: str
    monto: float
    meses: int
    fecha_pago: date
    metodo: str
    nota: Optional[str] = None
    anulado: bool
    motivo_anulacion: Optional[str] = None
    anulado_en: Optional[datetime] = None
    idempotency_key: str
    created_at: datetime
    nueva_fecha_corte: Optional[date] = None

class SubscriptionUpdatePrice(BaseModel):
    nuevo_valor_mensual: Decimal = Field(..., ge=0, description="Nuevo valor mensual de la suscripción (RF-14)")
    vigente_desde: Optional[date] = Field(default_factory=date.today)
