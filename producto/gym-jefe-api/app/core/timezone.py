from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo
from app.core.config import settings

LOCAL_TZ = ZoneInfo(settings.TIMEZONE)


def now_utc() -> datetime:
    """Retorna la fecha/hora actual en UTC con zona horaria explícita."""
    return datetime.now(timezone.utc)


def now_local() -> datetime:
    """Retorna la fecha/hora actual en la zona horaria del gimnasio (America/Bogota)."""
    return datetime.now(LOCAL_TZ)


def today_local() -> date:
    """Retorna la fecha local actual en America/Bogota."""
    return now_local().date()


def get_local_day_range_utc(target_date: date) -> tuple[datetime, datetime]:
    """
    Retorna el rango UTC (inicio, fin) correspondiente a las 00:00:00 y 23:59:59.999999
    del día local indicado en America/Bogota.
    Útil para queries de caja, asistencia y reportes diarios con corte a medianoche.
    """
    start_local = datetime.combine(target_date, time.min, tzinfo=LOCAL_TZ)
    end_local = datetime.combine(target_date, time.max, tzinfo=LOCAL_TZ)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc)
    )
