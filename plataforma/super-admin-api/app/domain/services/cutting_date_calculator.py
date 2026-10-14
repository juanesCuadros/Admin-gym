"""Regla de la fecha de corte del gimnasio (requisitos Super-Admin §3, SA-RF-17).

    ancla       = fecha_inicio, o la fecha del último pago registrado estando bloqueado o suspendido
    meses       = Σ meses de pagos NO anulados desde el ancla (incluido el pago que la fijó)
    fecha_corte = sumar_meses(ancla, meses)   ← en UN solo paso, con ajuste a fin de mes

Si un pago fija el ancla se decide AL REGISTRARLO (con el estado de ese momento) y se guarda en
`pagos.fija_ancla`. Así la anulación posterior de otros pagos no mueve el ancla (CA3) y anular el
propio pago que la fijó deja el corte en el ancla (CA6, SA-RF-09 CA5).
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, List, Optional

# Días de gracia del SaaS (§2.2): en_gracia 1 ≤ d ≤ 3; bloqueado d ≥ 4.
# Mismo umbral que platform.estado_suscripcion() en la BD.
DIAS_GRACIA = 3


@dataclass(frozen=True)
class PagoCorte:
    """Datos de un pago que intervienen en el corte, en orden de registro."""
    fecha_pago: date
    meses: int
    anulado: bool = False
    fija_ancla: bool = False


class CuttingDateCalculator:
    """Servicio de dominio puro: sin BD ni reloj."""

    @staticmethod
    def add_months(source_date: date, months: int) -> date:
        """Suma meses conservando el día, con ajuste al último día del mes."""
        month = source_date.month - 1 + months
        year = source_date.year + month // 12
        month = month % 12 + 1
        day = min(source_date.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

    @staticmethod
    def pago_fija_ancla(corte_vigente: Optional[date], fecha_pago: date, estado_guardado: str) -> bool:
        """¿El pago que se va a registrar fija una nueva ancla?

        Sí cuando el gimnasio está en prueba (prueba → activo, ancla = fecha del pago), suspendido
        (reactivación) o bloqueado por falta de pago en la fecha del pago (d ≥ 4).
        """
        if estado_guardado in ("prueba", "suspendido"):
            return True
        if corte_vigente is None:
            # Cliente activo sin pagos todavía: el pago inicial suma sobre fecha_inicio.
            return False
        return (fecha_pago - corte_vigente).days >= DIAS_GRACIA + 1

    @classmethod
    def calcular(
        cls,
        fecha_inicio: date,
        tipo_inicio: str,
        pagos: Iterable[PagoCorte],
        dias_prueba: int = 5,
    ) -> Optional[date]:
        """Fecha de corte desde el historial completo de pagos (anulados incluidos), en orden de registro."""
        lista: List[PagoCorte] = list(pagos)

        indice_ancla = None
        for i, p in enumerate(lista):
            if p.fija_ancla:
                indice_ancla = i

        if indice_ancla is None:
            ancla = fecha_inicio
            segmento = lista
        else:
            ancla = lista[indice_ancla].fecha_pago
            segmento = lista[indice_ancla:]

        meses = sum(p.meses for p in segmento if not p.anulado)

        if indice_ancla is None and meses == 0:
            if tipo_inicio == "prueba":
                return fecha_inicio + timedelta(days=dias_prueba)
            if not lista:
                return None  # Cliente activo sin ningún pago registrado.
        return cls.add_months(ancla, meses)

    @classmethod
    def calculate_cutting_date(
        cls,
        fecha_inicio: date,
        tipo_inicio: str,
        pagos_meses: List[int],
        trial_days: int = 5
    ) -> Optional[date]:
        """Compatibilidad: pagos vigentes sin ancla nueva (todos sumados sobre fecha_inicio)."""
        return cls.calcular(
            fecha_inicio, tipo_inicio, [PagoCorte(fecha_inicio, m) for m in pagos_meses], trial_days
        )
