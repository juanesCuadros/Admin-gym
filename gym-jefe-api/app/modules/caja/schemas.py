from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field


# --- Turnos de Caja ---
class AbrirTurnoRequest(BaseModel):
    base_inicial: Decimal = Field(Decimal("0.0"), ge=0, description="Base en efectivo con la que inicia el turno")


class CerrarTurnoRequest(BaseModel):
    efectivo_contado: Decimal = Field(..., ge=0, description="Efectivo físico real contado en caja al cerrar")


class CierreForzadoRequest(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255, description="Motivo obligatorio del cierre forzado por parte del Jefe")
    efectivo_contado: Optional[Decimal] = Field(None, ge=0, description="Efectivo contado si se realizó arqueo físico")


class TurnoResumenDto(BaseModel):
    id: UUID
    gimnasio_id: UUID
    staff_id: UUID
    staff_nombre: Optional[str] = None
    base_inicial: Decimal
    abierto_en: datetime
    cerrado_en: Optional[datetime] = None
    estado: str  # 'abierto' | 'cerrado'
    ventas_efectivo: Decimal = Decimal("0.0")
    ventas_otro: Decimal = Decimal("0.0")
    pagos_membresia_efectivo: Decimal = Decimal("0.0")
    pagos_membresia_otro: Decimal = Decimal("0.0")
    egresos_efectivo: Decimal = Decimal("0.0")
    devoluciones_efectivo: Decimal = Decimal("0.0")
    total_esperado_efectivo: Decimal = Decimal("0.0")
    efectivo_contado: Optional[Decimal] = None
    diferencia: Optional[Decimal] = None
    cierre_forzado: bool = False
    revisado_en: Optional[datetime] = None


# --- Punto de Venta (Ventas Multi-Ítem) ---
class VentaItemRequest(BaseModel):
    tipo: Literal["producto", "pase_dia", "pase_clase"] = Field(
        ...,
        description="Tipo de ítem comercial. Toda renovación de membresía debe pasar por /caja/pagos-membresia."
    )
    producto_id: Optional[UUID] = Field(None, description="UUID del producto (obligatorio si tipo == 'producto')")
    descripcion: str = Field(..., min_length=2, max_length=200, description="Descripción del ítem")
    cantidad: int = Field(..., gt=0, description="Cantidad a cobrar")
    precio_unitario: Optional[Decimal] = Field(
        None,
        ge=0,
        description="Precio unitario para pases de día o clase. Para 'producto', se ignora y se toma platform.productos.precio."
    )


class RegistrarVentaRequest(BaseModel):
    deportista_id: Optional[UUID] = Field(None, description="UUID del deportista registrado (NULL si es cliente walk-in/anónimo)")
    metodo: str = Field(..., min_length=2, max_length=50, description="Método en texto libre (efectivo, nequi, daviplata, datáfono)")
    tipo_medio: Literal["efectivo", "otro"] = Field(..., description="Categoría base del medio de pago")
    valor_recibido: Optional[Decimal] = Field(None, ge=0, description="Valor entregado por el cliente en pagos en efectivo")
    items: List[VentaItemRequest] = Field(..., min_length=1, description="Lista de ítems cobrados")


class VentaItemResponseDto(BaseModel):
    id: UUID
    tipo: str
    producto_id: Optional[UUID] = None
    descripcion: str
    cantidad: int
    precio_unitario: Decimal
    subtotal: Decimal


class VentaResponseDto(BaseModel):
    id: UUID
    turno_id: UUID
    deportista_id: Optional[UUID] = None
    total: Decimal
    metodo: str
    tipo_medio: str
    valor_recibido: Optional[Decimal] = None
    cambio_devuelto: Optional[Decimal] = None
    anulada: bool
    motivo_anulacion: Optional[str] = None
    idempotency_key: str
    items: List[VentaItemResponseDto]
    created_at: datetime
    idempotente_reintento: bool = False


class AnularVentaRequest(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255, description="Motivo obligatorio de la anulación")
    tipo_medio_reembolso: Literal["efectivo", "otro"] = Field(
        ...,
        description="Medio por el cual se devuelve el dinero (efectivo u otro). Puede ser distinto al medio original."
    )


# --- Pagos de Membresía ligados al turno ---
class RegistrarPagoMembresiaRequest(BaseModel):
    membresia_id: UUID = Field(..., description="UUID de la membresía a renovar o cobrar")
    monto: Decimal = Field(..., gt=0, description="Valor pagado")
    metodo: str = Field(..., min_length=2, max_length=50, description="Texto libre (efectivo, nequi, tarjeta)")
    tipo_medio: Literal["efectivo", "otro"] = Field(..., description="Categoría de medio de pago")
    dias_agregados: int = Field(..., ge=0, description="Días de vigencia a sumar a la membresía")
    valor_recibido: Optional[Decimal] = Field(None, ge=0, description="Valor recibido si paga en efectivo para cálculo de cambio")


class PagoMembresiaResponseDto(BaseModel):
    id: UUID
    turno_id: UUID
    membresia_id: UUID
    monto: Decimal
    metodo: str
    tipo_medio: str
    dias_agregados: int
    nueva_fecha_vencimiento: date
    valor_recibido: Optional[Decimal] = None
    cambio_devuelto: Optional[Decimal] = None
    anulado: bool
    motivo_anulacion: Optional[str] = None
    idempotency_key: str
    created_at: datetime
    idempotente_reintento: bool = False


class AnularPagoMembresiaRequest(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255, description="Motivo obligatorio de anulación del pago")


# --- Egresos y Vales de Caja ---
class RegistrarEgresoRequest(BaseModel):
    monto: Decimal = Field(..., gt=0, description="Monto en efectivo a retirar de la caja")
    motivo: str = Field(..., min_length=4, max_length=255, description="Justificación del gasto o vale")


class EgresoResponseDto(BaseModel):
    id: UUID
    turno_id: UUID
    monto: Decimal
    motivo: str
    registrado_por_nombre: Optional[str] = None
    created_at: datetime


# --- Movimientos Consolidados del Turno ---
class MovimientoCajaItemDto(BaseModel):
    id: str
    tipo_movimiento: str  # 'venta' | 'pago_membresia' | 'egreso' | 'devolucion'
    monto: Decimal
    metodo: Optional[str] = None
    tipo_medio: Optional[str] = None
    concepto: str
    anulado: bool = False
    ts: datetime


class HistorialMovimientosTurnoResponse(BaseModel):
    turno_id: UUID
    total_movimientos: int
    items: List[MovimientoCajaItemDto]
