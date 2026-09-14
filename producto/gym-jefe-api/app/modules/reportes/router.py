"""Router para el módulo de Reportes y Métricas (RF-41 a RF-44)"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_permission
from app.modules.reportes.schemas import (
    FormatoExportar,
    ReporteAsistenciaResponse,
    ReporteDeportistasInactivosResponse,
    ReporteIngresosResponse,
    ReporteMembresiasPorVencerResponse,
    TipoReporteExportar,
)
from app.modules.reportes.service import ReportesService

router = APIRouter(prefix="/reportes", tags=["10. Reportes y Métricas"])


@router.get("/status", summary="Estado del módulo reportes")
async def get_status():
    """Retorna el estado de disponibilidad del módulo de Reportes y Métricas."""
    return {"modulo": "reportes", "estado": "activo"}


@router.get(
    "/ingresos",
    response_model=ReporteIngresosResponse,
    summary="Reporte de ingresos por periodo, fuente y método (RF-41)",
    description="Calcula las sumatorias financieras de ventas y membresías en el periodo con corte exacto en UTC local. Excluye anuladas de los totales pero las mantiene trazables.",
)
async def obtener_reporte_ingresos(
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (default: primer día del mes actual)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (default: hoy en hora local)"),
    metodo: Optional[str] = Query(None, description="Filtrar por método de pago (efectivo, nequi, etc.)"),
    fuente: Optional[str] = Query(None, description="Filtrar por fuente de ingreso: 'membresias' o 'mostrador'"),
    current_staff: AuthenticatedStaff = Depends(require_permission("reportes", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await ReportesService.obtener_reporte_ingresos(
        session=session,
        gym_id=current_staff.gimnasio_id,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        metodo=metodo,
        fuente=fuente,
    )


@router.get(
    "/membresias-por-vencer",
    response_model=ReporteMembresiasPorVencerResponse,
    summary="Reporte accionable de membresías por vencer (RF-42)",
    description="Lista deportistas cuya membresía activa está próxima a vencer dentro del umbral configurable del gimnasio, incluyendo datos de contacto directos.",
)
async def obtener_membresias_por_vencer(
    dias: Optional[int] = Query(None, ge=1, le=90, description="Umbral opcional de días (default: dias_umbral_por_vencer del tenant)"),
    pagina: int = Query(1, ge=1, description="Número de página"),
    limite: int = Query(50, ge=1, le=100, description="Cantidad de registros por página"),
    current_staff: AuthenticatedStaff = Depends(require_permission("reportes", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await ReportesService.obtener_membresias_por_vencer(
        session=session,
        gym_id=current_staff.gimnasio_id,
        dias=dias,
        pagina=pagina,
        limite=limite,
    )


@router.get(
    "/asistencia",
    response_model=ReporteAsistenciaResponse,
    summary="Reporte de asistencia y afluencia por horarios (RF-43)",
    description="Muestra métricas de check-ins permitidos vs denegados, curva horaria (0 a 23h) para horas pico y top deportistas más constantes.",
)
async def obtener_reporte_asistencia(
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (default: 7 días atrás)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (default: hoy)"),
    current_staff: AuthenticatedStaff = Depends(require_permission("reportes", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await ReportesService.obtener_reporte_asistencia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )


@router.get(
    "/deportistas-inactivos",
    response_model=ReporteDeportistasInactivosResponse,
    summary="Reporte accionable de deportistas inactivos (RF-43 extensión)",
    description="Identifica deportistas con membresía activa pero sin registro de check-in en los últimos N días para acciones proactivas de retención.",
)
async def obtener_deportistas_inactivos(
    dias_sin_asistencia: int = Query(15, ge=1, le=365, description="Días mínimos consecutivos sin check-in para considerar inactivo"),
    pagina: int = Query(1, ge=1, description="Número de página"),
    limite: int = Query(50, ge=1, le=100, description="Cantidad de registros por página"),
    current_staff: AuthenticatedStaff = Depends(require_permission("reportes", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await ReportesService.obtener_deportistas_inactivos(
        session=session,
        gym_id=current_staff.gimnasio_id,
        dias_sin_asistencia=dias_sin_asistencia,
        pagina=pagina,
        limite=limite,
    )


@router.get(
    "/exportar",
    summary="Exportar reportes a CSV o Excel (RF-44)",
    description="Descarga en memoria el reporte solicitado en formato CSV (con BOM UTF-8) o Excel (.xlsx), reutilizando la misma fuente de agregación.",
)
async def exportar_reporte(
    tipo_reporte: TipoReporteExportar = Query(..., description="Reporte a exportar: ingresos, membresias_por_vencer, asistencia, deportistas_inactivos"),
    formato: FormatoExportar = Query("csv", description="Formato de salida: 'csv' o 'excel'"),
    fecha_inicio: Optional[date] = Query(None, description="Fecha de inicio (para ingresos y asistencia)"),
    fecha_fin: Optional[date] = Query(None, description="Fecha de fin (para ingresos y asistencia)"),
    metodo: Optional[str] = Query(None, description="Filtro de método de pago (para ingresos)"),
    fuente: Optional[str] = Query(None, description="Filtro de fuente (para ingresos)"),
    dias: Optional[int] = Query(None, ge=1, le=90, description="Umbral de días (para membresías por vencer)"),
    dias_sin_asistencia: int = Query(15, ge=1, le=365, description="Días sin asistencia (para deportistas inactivos)"),
    current_staff: AuthenticatedStaff = Depends(require_permission("reportes", "leer")),
    session: AsyncSession = Depends(get_db_session),
):
    return await ReportesService.exportar_reporte(
        session=session,
        gym_id=current_staff.gimnasio_id,
        tipo_reporte=tipo_reporte,
        formato=formato,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
        metodo=metodo,
        fuente=fuente,
        dias=dias,
        dias_sin_asistencia=dias_sin_asistencia,
    )
