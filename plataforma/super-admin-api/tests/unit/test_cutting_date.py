from datetime import date, timedelta
from app.domain.services.cutting_date_calculator import CuttingDateCalculator

def test_add_months_standard():
    start = date(2026, 1, 15)
    result = CuttingDateCalculator.add_months(start, 3)
    assert result == date(2026, 4, 15)

def test_add_months_year_boundary():
    start = date(2026, 11, 10)
    result = CuttingDateCalculator.add_months(start, 2)
    assert result == date(2027, 1, 10)

def test_add_months_month_end_bounds():
    # Jan 31 + 1 month in non-leap year -> Feb 28
    start = date(2026, 1, 31)
    result = CuttingDateCalculator.add_months(start, 1)
    assert result == date(2026, 2, 28)

def test_calculate_cutting_date_trial():
    start = date(2026, 9, 1)
    result = CuttingDateCalculator.calculate_cutting_date(
        fecha_inicio=start,
        tipo_inicio="prueba",
        pagos_meses=[],
        trial_days=5
    )
    assert result == date(2026, 9, 6)

def test_calculate_cutting_date_multiple_payments():
    start = date(2026, 1, 1)
    # 1 month payment + 3 months payment = 4 months
    result = CuttingDateCalculator.calculate_cutting_date(
        fecha_inicio=start,
        tipo_inicio="cliente_activo",
        pagos_meses=[1, 3]
    )
    assert result == date(2026, 5, 1)

def test_calculate_cutting_date_voided_recalculation():
    # If a 3-month payment was voided, now list only has [1]
    start = date(2026, 1, 1)
    result = CuttingDateCalculator.calculate_cutting_date(
        fecha_inicio=start,
        tipo_inicio="cliente_activo",
        pagos_meses=[1]
    )
    assert result == date(2026, 2, 1)
