"""Tarea 2 · Regla del ancla recalculada en la misma transacción de cada pago y anulación (§3)."""
import uuid
from datetime import timedelta

import pytest

from app.core.fechas import hoy_bogota
from app.domain.services.cutting_date_calculator import CuttingDateCalculator
from app.infrastructure.models.superadmin_models import Gimnasio, Pago, Auditoria
from app.infrastructure.repositories.audit_repository import AuditRepository
from pg_utilidades import crear_gimnasio, pagar


def test_pago_estando_bloqueado_fija_ancla_y_actualiza_corte(pg_client, pg_headers, pg_session):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    hoy = hoy_bogota()
    inicio = hoy - timedelta(days=70)
    gym = pg_session.get(Gimnasio, gym_id)
    gym.fecha_inicio = inicio
    pg_session.commit()

    r1 = pagar(pg_client, pg_headers, gym_id, meses=1, fecha_pago=inicio)
    assert r1.status_code == 201, r1.text
    assert r1.json()["nueva_fecha_corte"] == CuttingDateCalculator.add_months(inicio, 1).isoformat()

    # Hoy el gimnasio lleva más de 4 días vencido: el pago fija la nueva ancla.
    r2 = pagar(pg_client, pg_headers, gym_id, meses=1, fecha_pago=hoy)
    assert r2.status_code == 201, r2.text
    assert r2.json()["nueva_fecha_corte"] == CuttingDateCalculator.add_months(hoy, 1).isoformat()
    pago = pg_session.get(Pago, r2.json()["id"])
    assert pago.fija_ancla is True
    pg_session.refresh(gym)
    assert gym.fecha_corte == CuttingDateCalculator.add_months(hoy, 1)


def test_anulacion_recalcula_corte_y_audita(pg_client, pg_headers, pg_session):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    hoy = hoy_bogota()
    r1 = pagar(pg_client, pg_headers, gym_id, meses=1, fecha_pago=hoy)
    r2 = pagar(pg_client, pg_headers, gym_id, meses=3, fecha_pago=hoy)
    assert r2.json()["nueva_fecha_corte"] == CuttingDateCalculator.add_months(hoy, 4).isoformat()

    anul = pg_client.post(
        f"/api/v1/admin/payments/{r2.json()['id']}/void",
        json={"motivo_anulacion": "Transferencia rechazada por el banco"},
        headers=pg_headers,
    )
    assert anul.status_code == 200, anul.text
    assert anul.json()["nueva_fecha_corte"] == CuttingDateCalculator.add_months(hoy, 1).isoformat()
    gym = pg_session.get(Gimnasio, gym_id)
    pg_session.refresh(gym)
    assert gym.fecha_corte == CuttingDateCalculator.add_months(hoy, 1)
    assert pg_session.query(Auditoria).filter_by(accion="ANULACION_PAGO", entidad_id=r2.json()["id"]).count() == 1

    # SA-RF-18 CA1: anular dos veces responde 409.
    otra = pg_client.post(
        f"/api/v1/admin/payments/{r2.json()['id']}/void",
        json={"motivo_anulacion": "Segundo intento de anulación"},
        headers=pg_headers,
    )
    assert otra.status_code == 409
    assert otra.json()["codigo"] == "PAGO_YA_ANULADO"


def test_si_la_auditoria_falla_el_pago_no_queda_registrado(pg_client, pg_headers, pg_session, monkeypatch):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    clave = f"idem-{uuid.uuid4()}"

    def _falla(*a, **k):
        raise RuntimeError("auditoría caída")

    monkeypatch.setattr(AuditRepository, "record_action", _falla)
    with pytest.raises(RuntimeError):
        pagar(pg_client, pg_headers, gym_id, meses=1, fecha_pago=hoy_bogota(), clave=clave)
    monkeypatch.undo()

    assert pg_session.query(Pago).filter_by(idempotency_key=clave).count() == 0
    gym = pg_session.get(Gimnasio, gym_id)
    pg_session.refresh(gym)
    assert gym.fecha_corte is None
