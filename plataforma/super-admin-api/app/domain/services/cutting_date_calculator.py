from datetime import date
from typing import List, Optional
import calendar

class CuttingDateCalculator:
    """
    Domain service to calculate gym cutting date (fecha_corte) strictly derived
    from the historical non-voided payments and gym start date (RNF-04 / RF-17 / RF-18).
    """

    @staticmethod
    def add_months(source_date: date, months: int) -> date:
        """Adds a given number of months to a date preserving end-of-month bounds."""
        month = source_date.month - 1 + months
        year = source_date.year + month // 12
        month = month % 12 + 1
        day = min(source_date.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

    @classmethod
    def calculate_cutting_date(
        cls,
        fecha_inicio: date,
        tipo_inicio: str,
        pagos_meses: List[int],
        trial_days: int = 5
    ) -> Optional[date]:
        """
        Calculates the derived cutting date.
        If no payments exist:
          - For 'prueba': returns fecha_inicio + trial_days
          - For 'cliente_activo' without initial payment: None or fecha_inicio
        If payments exist:
          - Starts from base date (fecha_inicio) and adds the total months of all valid payments.
        """
        if not pagos_meses:
            if tipo_inicio == "prueba":
                from datetime import timedelta
                return fecha_inicio + timedelta(days=trial_days)
            return None

        total_months = sum(pagos_meses)
        return cls.add_months(fecha_inicio, total_months)
