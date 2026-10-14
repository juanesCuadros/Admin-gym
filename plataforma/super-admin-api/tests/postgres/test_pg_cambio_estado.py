"""Tarea 4 · SA-RF-09: reactivar exige el pago en la misma operación, no reactiva al staff
desactivado por el Jefe, y suspender exige motivo. SA-RF-16 CA4 y SA-RF-10 CA2 para pagos."""
import uuid
from datetime import timedelta

import pytest

from app.core.fechas import hoy_bogota
from app.domain.services.cutting_date_calculator import CuttingDateCalculator
from app.infrastructure.models.platform_models import Staff, Tenant
from app.infrastructure.models.superadmin_models import Gimnasio, Pago, Auditoria
from app.infrastructure.repositories.audit_repository import AuditRepository
from pg_utilidades import crear_gimnasio, pagar


def _estado(client, headers, gym_id, nuevo, motivo=None, pago=None):
    body = {"nuevo_estado": nuevo}
    if motivo:
        body["motivo"] = motivo
    if pago:
        body["pago"] = pago
    return client.patch(f"/api/v1/admin/gyms/{gym_id}/status", json=body, headers=headers)


def _pago(meses=1, fecha=None, clave=None):
    return {
        "monto": 150000 * meses, "meses": meses, "metodo": "Transferencia",
        "fecha_pago": (fecha or hoy_bogota()).isoformat(),
        "idempotency_key": clave or f"idem-{uuid.uuid4()}",
    }


@pytest.fixture
def gym_suspendido(pg_client, pg_headers, pg_session):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    assert pagar(pg_client, pg_headers, gym_id, 1, hoy_bogota() - timedelta(days=60)).status_code == 201
    r = _estado(pg_client, pg_headers, gym_id, "suspendido", motivo="Mora de más de un mes")
    assert r.status_code == 200, r.text
    return gym_id


def test_suspender_sin_motivo_responde_422(pg_client, pg_headers):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    r = _estado(pg_client, pg_headers, gym_id, "suspendido")
    assert r.status_code == 422
    assert r.json()["codigo"] == "MOTIVO_REQUERIDO"
    r = _estado(pg_client, pg_headers, gym_id, "suspendido", motivo="  ")
    assert r.status_code == 422


def test_transicion_no_permitida_responde_422(pg_client, pg_headers, gym_suspendido):
    r = _estado(pg_client, pg_headers, gym_suspendido, "prueba")
    assert r.status_code == 422
    assert r.json()["codigo"] == "TRANSICION_INVALIDA"


def test_reactivar_sin_pago_responde_422_y_no_cambia_estado(pg_client, pg_headers, pg_session, gym_suspendido):
    r = _estado(pg_client, pg_headers, gym_suspendido, "activo")
    assert r.status_code == 422
    assert r.json()["codigo"] == "PAGO_REQUERIDO"
    assert pg_session.get(Gimnasio, gym_suspendido).estado == "suspendido"


def test_reactivar_con_pago_fija_ancla_en_la_fecha_del_pago(pg_client, pg_headers, pg_session, gym_suspendido):
    hoy = hoy_bogota()
    r = _estado(pg_client, pg_headers, gym_suspendido, "activo", pago=_pago(meses=2, fecha=hoy))
    assert r.status_code == 200, r.text
    assert r.json()["estado"] == "activo"
    assert r.json()["fecha_corte"] == CuttingDateCalculator.add_months(hoy, 2).isoformat()
    pago = pg_session.query(Pago).filter_by(gimnasio_id=gym_suspendido).order_by(Pago.created_at.desc()).first()
    assert pago.fija_ancla is True
    acciones = {a.accion for a in pg_session.query(Auditoria).filter_by(gimnasio_id=gym_suspendido)}
    assert {"REGISTRO_PAGO", "CAMBIO_ESTADO_GIMNASIO"} <= acciones
    gym = pg_session.get(Gimnasio, gym_suspendido)
    assert pg_session.get(Tenant, gym.gimnasio_id).activo is True


def test_si_el_pago_falla_el_estado_no_cambia(pg_client, pg_headers, pg_session, gym_suspendido, monkeypatch):
    # Pago inválido (fecha futura): 422 y el gimnasio sigue suspendido.
    r = _estado(pg_client, pg_headers, gym_suspendido, "activo", pago=_pago(fecha=hoy_bogota() + timedelta(days=1)))
    assert r.status_code == 422
    assert pg_session.get(Gimnasio, gym_suspendido).estado == "suspendido"

    # Falla a mitad de la transacción (auditoría): ni pago ni cambio de estado.
    clave = f"idem-{uuid.uuid4()}"
    monkeypatch.setattr(AuditRepository, "record_action", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    with pytest.raises(RuntimeError):
        _estado(pg_client, pg_headers, gym_suspendido, "activo", pago=_pago(clave=clave))
    monkeypatch.undo()
    gym = pg_session.get(Gimnasio, gym_suspendido)
    pg_session.refresh(gym)
    assert gym.estado == "suspendido"
    assert pg_session.query(Pago).filter_by(idempotency_key=clave).count() == 0


def test_reactivar_no_reactiva_staff_desactivado_por_el_jefe(pg_client, pg_headers, pg_session):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    assert pagar(pg_client, pg_headers, gym_id, 1, hoy_bogota()).status_code == 201
    tenant_id = pg_session.get(Gimnasio, gym_id).gimnasio_id
    despedido = Staff(gimnasio_id=tenant_id, nombre="Ex recepcionista", correo=f"ex-{uuid.uuid4().hex[:6]}@g.co",
                      hash_password="x", rol="recepcionista", activo=False)
    vigente = Staff(gimnasio_id=tenant_id, nombre="Entrenadora", correo=f"en-{uuid.uuid4().hex[:6]}@g.co",
                    hash_password="x", rol="entrenador", activo=True)
    pg_session.add_all([despedido, vigente])
    pg_session.commit()

    assert _estado(pg_client, pg_headers, gym_id, "suspendido", motivo="Mora de dos meses").status_code == 200
    r = _estado(pg_client, pg_headers, gym_id, "activo", pago=_pago())
    assert r.status_code == 200, r.text

    pg_session.refresh(despedido)
    pg_session.refresh(vigente)
    assert despedido.activo is False
    assert vigente.activo is True


def test_pago_directo_a_suspendido_o_cancelado_se_rechaza(pg_client, pg_headers, pg_session, gym_suspendido):
    r = pagar(pg_client, pg_headers, gym_suspendido, 1, hoy_bogota())
    assert r.status_code == 422
    assert r.json()["codigo"] == "USAR_REACTIVACION"

    assert _estado(pg_client, pg_headers, gym_suspendido, "cancelado", motivo="Cierre del negocio").status_code == 200
    r = pagar(pg_client, pg_headers, gym_suspendido, 1, hoy_bogota())
    assert r.status_code == 422
    assert r.json()["codigo"] == "GIMNASIO_CANCELADO"


def test_anular_pago_de_reactivacion_no_revierte_estado_y_advierte(pg_client, pg_headers, pg_session, gym_suspendido):
    hoy = hoy_bogota()
    assert _estado(pg_client, pg_headers, gym_suspendido, "activo", pago=_pago(fecha=hoy)).status_code == 200
    pago = pg_session.query(Pago).filter_by(gimnasio_id=gym_suspendido, fija_ancla=True).one()
    r = pg_client.post(f"/api/v1/admin/payments/{pago.id}/void",
                       json={"motivo_anulacion": "Consignación devuelta"}, headers=pg_headers)
    assert r.status_code == 200, r.text
    assert r.json()["advertencia"]
    assert r.json()["nueva_fecha_corte"] == hoy.isoformat()  # CA6: corte = ancla
    gym = pg_session.get(Gimnasio, gym_suspendido)
    pg_session.refresh(gym)
    assert gym.estado == "activo"


def test_prueba_a_activo_con_pago(pg_client, pg_headers, pg_session):
    gym_id = crear_gimnasio(pg_client, pg_headers, tipo="prueba")
    hoy = hoy_bogota()
    r = _estado(pg_client, pg_headers, gym_id, "activo", pago=_pago(fecha=hoy))
    assert r.status_code == 200, r.text
    assert r.json()["fecha_corte"] == CuttingDateCalculator.add_months(hoy, 1).isoformat()
