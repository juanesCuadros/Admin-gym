"""
Schemas Pydantic para el módulo 08: Inventario y Stock (RF-36 a RF-38).
"""
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field, field_validator, model_validator


# =====================================================================
# REQUEST SCHEMAS
# =====================================================================

class CrearProductoRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre único del producto en el gimnasio")
    precio_compra: Decimal = Field(Decimal("0.00"), ge=0, description="Precio de compra o costo unitario en COP")
    precio: Decimal = Field(..., ge=0, description="Precio de venta al público en COP")
    stock_inicial: int = Field(0, ge=0, description="Cantidad inicial de unidades en bodega/inventario")
    activo: bool = Field(True, description="Indica si el producto está disponible comercialmente")


class ActualizarProductoRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre descriptivo del producto")
    precio_compra: Optional[Decimal] = Field(None, ge=0, description="Precio unitario de compra o costo en COP")
    precio: Decimal = Field(..., ge=0, description="Precio unitario de venta")
    version: int = Field(..., ge=1, description="Versión actual del producto para control de concurrencia optimista")
    # NOTA: El stock NO se muta mediante este endpoint para preservar la integridad del Kardex.


class CambiarEstadoProductoRequest(BaseModel):
    activo: bool = Field(..., description="Nuevo estado del producto (true: activo, false: desactivado)")


class EntradaStockRequest(BaseModel):
    cantidad: int = Field(..., gt=0, description="Cantidad positiva de unidades a ingresar al inventario")
    motivo: Optional[str] = Field("Recepción de mercancía", max_length=255, description="Referencia descriptiva del ingreso")


class AjusteStockRequest(BaseModel):
    cantidad: int = Field(
        ...,
        description="Variación neta: positiva (+) si sobra inventario, negativa (-) si hay merma, rotura o pérdida"
    )
    motivo: str = Field(
        ...,
        min_length=10,
        max_length=255,
        description="Justificación obligatoria de la discrepancia para trazabilidad de auditoría"
    )

    @field_validator("cantidad")
    @classmethod
    def validar_no_cero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("La cantidad de ajuste debe ser distinta de cero (use valores positivos o negativos).")
        return v


# =====================================================================
# RESPONSE SCHEMAS
# =====================================================================

class ProductoResponse(BaseModel):
    id: UUID
    gimnasio_id: UUID
    nombre: str
    precio_compra: Decimal = Decimal("0.00")
    precio: Decimal
    ganancia_unitaria: Decimal = Decimal("0.00")
    margen_ganancia_pct: Decimal = Decimal("0.00")
    stock: int
    activo: bool
    version: int
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def calcular_margen(self) -> "ProductoResponse":
        compra = self.precio_compra or Decimal("0.00")
        venta = self.precio or Decimal("0.00")
        ganancia = venta - compra
        self.ganancia_unitaria = ganancia.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if venta > 0:
            pct = (ganancia / venta) * Decimal("100")
            self.margen_ganancia_pct = pct.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            self.margen_ganancia_pct = Decimal("0.00")
        return self


class StockMovimientoResponse(BaseModel):
    id: UUID
    producto_id: UUID
    producto_nombre: Optional[str] = None
    tipo: str  # 'entrada', 'ajuste', 'venta', 'devolucion'
    cantidad: int
    motivo: Optional[str] = None
    registrado_por: Optional[UUID] = None
    registrado_por_nombre: Optional[str] = None
    created_at: datetime


class PaginatedProductosResponse(BaseModel):
    items: List[ProductoResponse]
    total: int
    limit: int
    offset: int


class PaginatedStockMovimientosResponse(BaseModel):
    items: List[StockMovimientoResponse]
    total: int
    limit: int
    offset: int

