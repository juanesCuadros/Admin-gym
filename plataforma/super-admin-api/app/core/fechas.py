"""Fechas de negocio en America/Bogota (SA-RNF-08).

Toda fecha de negocio (inicio, corte, pago, vencimientos) se calcula en la zona de Bogotá.
Los instantes (timestamptz) se guardan en UTC. Prohibido usar la fecha local del servidor o instantes sin zona.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

ZONA_BOGOTA = ZoneInfo("America/Bogota")


def ahora_utc() -> datetime:
    """Instante actual en UTC (con zona)."""
    return datetime.now(timezone.utc)


def hoy_bogota() -> date:
    """Fecha de negocio de hoy en America/Bogota."""
    return datetime.now(ZONA_BOGOTA).date()


def fecha_bogota(instante: datetime) -> date:
    """Fecha de Bogotá de un instante (si no trae zona se asume UTC)."""
    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=timezone.utc)
    return instante.astimezone(ZONA_BOGOTA).date()
