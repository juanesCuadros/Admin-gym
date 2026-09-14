"""Schemas Pydantic para el módulo de Reportes y Métricas (RF-41 a RF-44)"""
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

TipoReporteExportar = Literal["ingresos", "membresias_por_vencer", "asistencia", "deportistas_inactivos"]
FormatoExportar = Literal["csv", "excel"]


class TransaccionReporteDto(BaseModel):
    """Detalle de transacción de ingreso en el periodo."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    fecha_hora: datetime
    tipo: str = Field(..., description="venta_mostrador | pago_membresia | devolucion")
    descripcion: str
    monto: Decimal
    metodo: str
    tipo_medio: str
    anulado: bool = False
    motivo_anulacion: Optional[str] = None
    registrado_por_nombre: Optional[str] = None


class ReporteIngresosResponse(BaseModel):
    """Resumen y desglose financiero de ingresos por periodo (RF-41)."""
    fecha_inicio: date
    fecha_fin: date
    total_ingresos_bruto: Decimal = Field(..., description="Total de ventas y pagos activos (sin devoluciones)")
    total_devoluciones: Decimal = Field(..., description="Total de devoluciones de dinero registradas en el periodo")
    total_ingresos_neto: Decimal = Field(..., description="Ingreso neto efectivo (bruto - devoluciones)")
    total_anulado: Decimal = Field(..., description="Total de transacciones anuladas en el periodo (trazable, no suma al neto)")
    desglose_por_metodo: Dict[str, Decimal] = Field(..., description="Sumatoria de ingresos netos por método (efectivo, nequi, etc.)")
    desglose_por_fuente: Dict[str, Decimal] = Field(..., description="Sumatoria por fuente (membresias, productos, otros_mostrador)")
    transacciones: List[TransaccionReporteDto] = Field(default_factory=list, description="Listado detallado de transacciones del periodo")


class MembresiaPorVencerItemDto(BaseModel):
    """Deportista con membresía próxima a vencer (RF-42)."""
    model_config = ConfigDict(from_attributes=True)

    membresia_id: UUID
    deportista_id: UUID
    nombre: str
    documento: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    plan_id: UUID
    plan_nombre: str
    fecha_inicio: date
    fecha_vencimiento: date
    dias_restantes: int
    congelamiento_activo: bool = False


class ReporteMembresiasPorVencerResponse(BaseModel):
    """Reporte accionable de retención para membresías próximas a vencer (RF-42)."""
    umbral_dias_aplicado: int
    total: int
    pagina: int
    limite: int
    total_paginas: int
    items: List[MembresiaPorVencerItemDto]


class AfluenciaHoraDto(BaseModel):
    """Distribución de afluencia por hora del día (00:00 a 23:00)."""
    hora: int
    cantidad: int


class AfluenciaDiaSemanaDto(BaseModel):
    """Distribución de afluencia por día de la semana."""
    dia_num: int
    dia_nombre: str
    cantidad: int


class TopDeportistaAsistenciaDto(BaseModel):
    """Top deportistas con mayor afluencia."""
    deportista_id: UUID
    nombre: str
    documento: str
    total_asistencias: int
    ultima_asistencia: Optional[datetime] = None


class ReporteAsistenciaResponse(BaseModel):
    """Reporte de control de ingreso y afluencia por horarios (RF-43)."""
    fecha_inicio: date
    fecha_fin: date
    total_accesos: int
    accesos_permitidos: int
    accesos_denegados: int
    cortesias: int
    afluencia_por_hora: List[AfluenciaHoraDto]
    afluencia_por_dia_semana: List[AfluenciaDiaSemanaDto]
    top_deportistas: List[TopDeportistaAsistenciaDto]


class DeportistaInactivoItemDto(BaseModel):
    """Deportista con membresía vigente pero sin check-in en los últimos N días (RF-43 extensión)."""
    model_config = ConfigDict(from_attributes=True)

    deportista_id: UUID
    nombre: str
    documento: str
    correo: Optional[str] = None
    telefono: Optional[str] = None
    plan_nombre: str
    fecha_vencimiento: date
    estado_membresia: str
    ultimo_checkin_utc: Optional[datetime] = None
    dias_sin_asistir: int


class ReporteDeportistasInactivosResponse(BaseModel):
    """Reporte accionable de deportistas inactivos para recuperación y retención (RF-43)."""
    dias_sin_asistencia_umbral: int
    total: int
    pagina: int
    limite: int
    total_paginas: int
    items: List[DeportistaInactivoItemDto]
