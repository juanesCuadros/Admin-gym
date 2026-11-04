"""Esquemas de gastos y pago a entrenadores (decisiones de Juan del 27-oct-2026)."""
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class RegistrarGastoRequest(BaseModel):
    categoria: str = Field(..., min_length=2, max_length=80, description="Arriendo, servicios, mantenimiento...")
    descripcion: Optional[str] = Field(None, max_length=255)
    beneficiario_tipo: Literal["staff", "externo"]
    beneficiario_staff_id: Optional[UUID] = Field(None, description="Obligatorio si el beneficiario es del staff")
    beneficiario_nombre: Optional[str] = Field(None, max_length=150, description="Obligatorio si es externo")
    metodo: Literal["efectivo", "transferencia"] = Field(..., description="El efectivo sale de la caja del turno propio")
    monto: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)

    @model_validator(mode="after")
    def _validar_beneficiario(self):
        if self.beneficiario_tipo == "staff" and not self.beneficiario_staff_id:
            raise ValueError("Elige a la persona del equipo que recibe el pago.")
        if self.beneficiario_tipo == "externo" and len((self.beneficiario_nombre or "").strip()) < 2:
            raise ValueError("Escribe el nombre de quien recibe el pago.")
        return self


class GastoResponse(BaseModel):
    id: UUID
    categoria: str
    descripcion: Optional[str] = None
    beneficiario_tipo: str
    beneficiario_staff_id: Optional[UUID] = None
    beneficiario_nombre: str
    metodo: str
    monto: Decimal
    fecha: date
    turno_id: Optional[UUID] = None
    registrado_por_nombre: Optional[str] = None
    created_at: datetime


class ListadoGastosResponse(BaseModel):
    items: List[GastoResponse]
    total: int
    suma: Decimal


class BeneficiarioStaff(BaseModel):
    id: UUID
    nombre: str
    rol: str


class ReporteResultadoResponse(BaseModel):
    desde: date
    hasta: date
    ingresos: Decimal
    gastos: Decimal
    resultado: Decimal
    gastos_por_categoria: Dict[str, Decimal]


class ConfigPagoEntrenadorRequest(BaseModel):
    esquema: Literal["fijo", "por_clase", "comision"]
    valor: Decimal = Field(..., ge=0, max_digits=12, decimal_places=2, description="Sueldo, valor por clase o % de comisión")
    base_comision: Optional[Literal["membresias_vendidas", "clientes_asignados"]] = None

    @model_validator(mode="after")
    def _validar(self):
        if self.esquema == "comision":
            if not self.base_comision:
                raise ValueError("Elige sobre qué se calcula la comisión.")
            if self.valor > 100:
                raise ValueError("La comisión no puede superar el 100 %.")
        elif self.base_comision:
            raise ValueError("La base solo aplica a la comisión.")
        return self


class LiquidacionEntrenador(BaseModel):
    staff_id: UUID
    nombre: str
    esquema: Optional[str] = None
    valor: Optional[Decimal] = None
    base_comision: Optional[str] = None
    clases_dictadas: int = 0
    base_calculo: Decimal = Decimal("0")
    monto_calculado: Decimal = Decimal("0")
    pagado: Decimal = Decimal("0")
    saldo: Decimal = Decimal("0")


class RegistrarPagoEntrenadorRequest(BaseModel):
    desde: date
    hasta: date
    monto: Decimal = Field(..., gt=0, max_digits=12, decimal_places=2)
    metodo: Literal["efectivo", "transferencia"]
    descripcion: Optional[str] = Field(None, max_length=255)

    @model_validator(mode="after")
    def _validar_periodo(self):
        if self.hasta < self.desde:
            raise ValueError("La fecha inicial no puede ser posterior a la final.")
        return self


class PagoEntrenadorResponse(BaseModel):
    id: UUID
    staff_id: UUID
    periodo_desde: date
    periodo_hasta: date
    monto_calculado: Decimal
    monto_pagado: Decimal
    gasto_id: UUID
