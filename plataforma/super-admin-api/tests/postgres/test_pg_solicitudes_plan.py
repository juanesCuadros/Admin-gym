"""Tarea 6 · Solicitudes de plan (contrato 3.1): listar, aprobar con pago idempotente y rechazar."""
import uuid

from sqlalchemy import text

from app.core.fechas import hoy_bogota
from app.domain.services.cutting_date_calculator import CuttingDateCalculator
from app.infrastructure.models.superadmin_models import Auditoria, Gimnasio, Pago, SolicitudPlan, Suscripcion
from pg_utilidades import como_superusuario, crear_gimnasio, plan_id, pagar

BASE = "/api/v1/admin/plan-requests"


def _solicitar(session, gym_id, plan, nota="Queremos crecer"):
    """Crea la solicitud con la misma función que usa el Sistema Web (platform.solicitar_plan)."""
    tenant = session.get(Gimnasio, gym_id).gimnasio_id
    with como_superusuario(session):
        return session.execute(
            text("SELECT platform.solicitar_plan(CAST(:g AS uuid), CAST(:p AS uuid), 'Laura Jefe', :n)"),
            {"g": tenant, "p": plan, "n": nota},
        ).scalar()


def _aprobar(client, headers, sol_id, clave, monto=150000, fecha=None):
    h = dict(headers)
    if clave:
        h["Idempotency-Key"] = clave
    return client.post(f"{BASE}/{sol_id}/approve", headers=h, json={
        "monto": monto, "fecha_pago": (fecha or hoy_bogota()).isoformat(), "metodo": "Transferencia"})


def test_listar_pendientes_con_forma_del_contrato(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    mensual = plan_id(pg_client, pg_headers, "mensual")
    sol = _solicitar(pg_session, gid, mensual)
    r = pg_client.get(BASE, params={"estado": "pendiente"}, headers=pg_headers)
    assert r.status_code == 200
    fila = next(f for f in r.json() if f["id"] == sol)
    assert fila["gimnasio"]["id"] == gid and fila["plan"]["id"] == mensual
    assert set(fila["plan"]) >= {"id", "nombre", "precio", "duracion_meses"}
    assert fila["solicitado_por"] == "Laura Jefe" and fila["nota"] == "Queremos crecer"
    assert fila["estado"] == "pendiente"


def test_aprobar_registra_pago_crea_suscripcion_y_es_idempotente(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)  # en prueba
    mensual = plan_id(pg_client, pg_headers, "mensual")
    pg_client.put(f"/api/v1/admin/plans/{mensual}", headers=pg_headers, json={
        "nombre": "Mensual", "precio": 150000, "duracion_meses": 1, "publico": True, "orden": 1,
        "version": next(p for p in pg_client.get("/api/v1/admin/plans", headers=pg_headers).json()
                        if p["id"] == mensual)["version"]})
    sol = _solicitar(pg_session, gid, mensual)
    hoy = hoy_bogota()

    sin_clave = _aprobar(pg_client, pg_headers, sol, None)
    assert sin_clave.status_code == 422

    clave = f"idem-{uuid.uuid4()}"
    r = _aprobar(pg_client, pg_headers, sol, clave)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "aprobada" and body["meses"] == 1 and body["plan_id"] == mensual
    assert body["estado_gimnasio"] == "activo"
    assert body["nueva_fecha_corte"] == CuttingDateCalculator.add_months(hoy, 1).isoformat()
    assert body["aviso_monto"] is None

    actual = pg_session.query(Suscripcion).filter_by(gimnasio_id=gid, vigente_hasta=None).one()
    assert actual.plan_id == mensual
    s = pg_session.get(SolicitudPlan, sol)
    pg_session.refresh(s)
    assert s.pago_id == body["pago_id"] and s.resuelta_por is not None

    # Reintento con la misma clave: mismo resultado, un solo pago.
    otra_vez = _aprobar(pg_client, pg_headers, sol, clave)
    assert otra_vez.status_code == 200 and otra_vez.json()["pago_id"] == body["pago_id"]
    assert pg_session.query(Pago).filter_by(idempotency_key=clave).count() == 1

    # Otra clave sobre una solicitud ya resuelta: 409.
    nueva = _aprobar(pg_client, pg_headers, sol, f"idem-{uuid.uuid4()}")
    assert nueva.status_code == 409 and nueva.json()["codigo"] == "SOLICITUD_NO_PENDIENTE"
    acciones = {a.accion for a in pg_session.query(Auditoria).filter_by(gimnasio_id=gid)}
    assert {"SOLICITUD_PLAN_APROBADA", "REGISTRO_PAGO", "CAMBIO_PLAN_GIMNASIO"} <= acciones


def test_aprobar_con_monto_distinto_avisa_sin_bloquear(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    sol = _solicitar(pg_session, gid, plan_id(pg_client, pg_headers, "mensual"))
    r = _aprobar(pg_client, pg_headers, sol, f"idem-{uuid.uuid4()}", monto=123)
    assert r.status_code == 200 and r.json()["aviso_monto"]


def test_aprobar_en_suspendido_se_rechaza(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    assert pagar(pg_client, pg_headers, gid, 1, hoy_bogota()).status_code == 201
    sol = _solicitar(pg_session, gid, plan_id(pg_client, pg_headers, "anual"))
    assert pg_client.patch(f"/api/v1/admin/gyms/{gid}/status", headers=pg_headers,
                           json={"nuevo_estado": "suspendido", "motivo": "Mora de dos meses"}).status_code == 200
    r = _aprobar(pg_client, pg_headers, sol, f"idem-{uuid.uuid4()}")
    assert r.status_code == 422 and r.json()["codigo"] == "USAR_REACTIVACION"
    assert pg_session.get(SolicitudPlan, sol).estado == "pendiente"


def test_rechazar_solicitud(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    sol = _solicitar(pg_session, gid, plan_id(pg_client, pg_headers, "mensual"))
    sin_motivo = pg_client.post(f"{BASE}/{sol}/reject", headers=pg_headers, json={"motivo": ""})
    assert sin_motivo.status_code == 422
    r = pg_client.post(f"{BASE}/{sol}/reject", headers=pg_headers, json={"motivo": "Debe ponerse al día primero"})
    assert r.status_code == 200 and r.json()["estado"] == "rechazada"
    assert r.json()["motivo_rechazo"] == "Debe ponerse al día primero"
    otra = pg_client.post(f"{BASE}/{sol}/reject", headers=pg_headers, json={"motivo": "Otra vez rechazada"})
    assert otra.status_code == 409
    assert pg_client.post(f"{BASE}/{uuid.uuid4()}/reject", headers=pg_headers,
                          json={"motivo": "No existe esta"}).status_code == 404
