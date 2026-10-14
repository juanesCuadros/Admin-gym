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


# ---------------------------------------------------------------------------
# Regla del ancla (requisitos SA §3). Un test por criterio de aceptación.
# ---------------------------------------------------------------------------
from app.domain.services.cutting_date_calculator import PagoCorte

calc = CuttingDateCalculator


def _registrar(fecha_inicio, pagos_previos, fecha_pago, meses, estado="activo", tipo="cliente_activo"):
    """Simula el registro: decide el ancla con el corte vigente y el estado de ese momento."""
    corte = calc.calcular(fecha_inicio, tipo, pagos_previos)
    nuevo = PagoCorte(fecha_pago, meses, fija_ancla=calc.pago_fija_ancla(corte, fecha_pago, estado))
    return pagos_previos + [nuevo]


def test_ca1_inicio_31_enero_mas_un_mes_cae_en_ultimo_dia_de_febrero():
    pagos = [PagoCorte(date(2026, 1, 31), 1)]
    assert calc.calcular(date(2026, 1, 31), "cliente_activo", pagos) == date(2026, 2, 28)


def test_ca2_dos_pagos_de_un_mes_suman_en_un_solo_paso():
    pagos = _registrar(date(2026, 1, 31), [], date(2026, 1, 31), 1)
    pagos = _registrar(date(2026, 1, 31), pagos, date(2026, 2, 28), 1)
    assert calc.calcular(date(2026, 1, 31), "cliente_activo", pagos) == date(2026, 3, 31)  # no 28-mar


def test_ca3_pago_de_tres_meses_anulado_no_mueve_el_ancla():
    inicio = date(2026, 1, 1)
    pagos = _registrar(inicio, [], date(2026, 1, 1), 1)
    pagos = _registrar(inicio, pagos, date(2026, 2, 1), 3)
    pagos = _registrar(inicio, pagos, date(2026, 5, 1), 1)
    anulado = PagoCorte(pagos[1].fecha_pago, 3, anulado=True, fija_ancla=pagos[1].fija_ancla)
    pagos = [pagos[0], anulado, pagos[2]]
    assert calc.calcular(inicio, "cliente_activo", pagos) == calc.add_months(inicio, 2)


def test_ca4_pago_en_gracia_suma_sobre_el_corte():
    inicio = date(2026, 2, 10)
    pagos = _registrar(inicio, [], date(2026, 2, 10), 1)
    assert calc.calcular(inicio, "cliente_activo", pagos) == date(2026, 3, 10)
    pagos = _registrar(inicio, pagos, date(2026, 3, 12), 1)  # d = 2: en gracia
    assert pagos[-1].fija_ancla is False
    assert calc.calcular(inicio, "cliente_activo", pagos) == date(2026, 4, 10)


def test_ca5_pago_estando_bloqueado_fija_nueva_ancla():
    inicio = date(2026, 2, 10)
    pagos = _registrar(inicio, [], date(2026, 2, 10), 1)
    pagos = _registrar(inicio, pagos, date(2026, 3, 20), 1)  # d = 10: bloqueado
    assert pagos[-1].fija_ancla is True
    assert calc.calcular(inicio, "cliente_activo", pagos) == date(2026, 4, 20)


def test_ca5_limite_d4_bloqueado_y_d3_gracia():
    corte = date(2026, 3, 10)
    assert calc.pago_fija_ancla(corte, date(2026, 3, 13), "activo") is False
    assert calc.pago_fija_ancla(corte, date(2026, 3, 14), "activo") is True


def test_ca6_todos_los_pagos_del_segmento_anulados_corte_igual_al_ancla():
    inicio = date(2026, 2, 10)
    pagos = _registrar(inicio, [], date(2026, 2, 10), 1)
    pagos = _registrar(inicio, pagos, date(2026, 3, 20), 1)  # ancla 20-mar
    pagos = _registrar(inicio, pagos, date(2026, 4, 15), 2)
    segmento_anulado = [pagos[0]] + [
        PagoCorte(p.fecha_pago, p.meses, anulado=True, fija_ancla=p.fija_ancla) for p in pagos[1:]
    ]
    assert calc.calcular(inicio, "cliente_activo", segmento_anulado) == date(2026, 3, 20)


def test_ca6_sin_pago_ancla_todos_anulados_corte_igual_a_fecha_inicio():
    inicio = date(2026, 2, 10)
    pagos = [PagoCorte(inicio, 1, anulado=True)]
    assert calc.calcular(inicio, "cliente_activo", pagos) == inicio


def test_pago_en_prueba_o_suspendido_siempre_fija_ancla():
    assert calc.pago_fija_ancla(date(2026, 3, 10), date(2026, 3, 5), "prueba") is True
    assert calc.pago_fija_ancla(date(2026, 3, 10), date(2026, 3, 5), "suspendido") is True


def test_prueba_que_paga_queda_con_ancla_en_la_fecha_del_pago():
    inicio = date(2026, 9, 1)
    pagos = _registrar(inicio, [], date(2026, 9, 4), 1, estado="prueba", tipo="prueba")
    assert calc.calcular(inicio, "prueba", pagos) == date(2026, 10, 4)
