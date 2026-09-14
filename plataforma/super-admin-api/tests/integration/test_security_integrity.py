import pytest
from app.infrastructure.models.platform_models import Tenant, Staff

def test_gym_cancellation_and_suspension_freezes_platform_access(client, db_session, superadmin_auth_headers):
    """
    Validates RF-09 / RF-10: Suspending or cancelling a gym properly freezes access
    by deactivating platform.tenant and platform.staff records.
    """
    # 1. Create a gym
    create_resp = client.post(
        "/api/v1/admin/gyms",
        json={
            "nombre": "Freeze Test Gym",
            "jefe": {"nombre": "Owner", "correo": "owner@freezetest.com"},
            "suscripcion": {"valor_mensual": 150000.0, "tipo_inicio": "prueba"}
        },
        headers=superadmin_auth_headers
    )
    assert create_resp.status_code == 201
    gym_id = create_resp.json()["gimnasio"]["id"]
    tenant_id = create_resp.json()["gimnasio"]["gimnasio_id"]

    # Verify initial active state in platform
    tenant = db_session.query(Tenant).filter(Tenant.id == tenant_id).first()
    assert tenant is not None
    assert tenant.activo is True

    staff = db_session.query(Staff).filter(Staff.gimnasio_id == tenant_id).first()
    assert staff is not None
    assert staff.activo is True

    # 2. Suspend the gym (RF-09)
    suspend_resp = client.patch(
        f"/api/v1/admin/gyms/{gym_id}/status",
        json={"nuevo_estado": "suspendido"},
        headers=superadmin_auth_headers
    )
    # Note: from prueba, valid transitions are 'activo' and 'cancelado'.
    # First activate:
    client.patch(
        f"/api/v1/admin/gyms/{gym_id}/status",
        json={"nuevo_estado": "activo"},
        headers=superadmin_auth_headers
    )
    suspend_resp = client.patch(
        f"/api/v1/admin/gyms/{gym_id}/status",
        json={"nuevo_estado": "suspendido"},
        headers=superadmin_auth_headers
    )
    assert suspend_resp.status_code == 200

    # Refresh DB session and verify platform tenant and staff are frozen (activo = False)
    db_session.expire_all()
    tenant_suspended = db_session.query(Tenant).filter(Tenant.id == tenant_id).first()
    assert tenant_suspended.activo is False

    staff_suspended = db_session.query(Staff).filter(Staff.gimnasio_id == tenant_id).first()
    assert staff_suspended.activo is False

    # 3. Formal Cancellation (RF-10)
    cancel_resp = client.post(
        f"/api/v1/admin/gyms/{gym_id}/cancel",
        json={"motivo": "Cierre formal de operaciones por solicitud del cliente"},
        headers=superadmin_auth_headers
    )
    assert cancel_resp.status_code == 200

    db_session.expire_all()
    tenant_cancelled = db_session.query(Tenant).filter(Tenant.id == tenant_id).first()
    assert tenant_cancelled.activo is False

    staff_cancelled = db_session.query(Staff).filter(Staff.gimnasio_id == tenant_id).first()
    assert staff_cancelled.activo is False

def test_gym_detail_includes_payment_history_and_recent_activity(client, superadmin_auth_headers):
    """
    Validates RF-07: The detailed gym sheet includes data, status, subscription,
    Jefe account, payment history, and recent audit activity.
    """
    # 1. Create gym
    create_resp = client.post(
        "/api/v1/admin/gyms",
        json={
            "nombre": "Detail Complete Gym",
            "jefe": {"nombre": "Mario Jefe", "correo": "mario@detailgym.com"},
            "suscripcion": {"valor_mensual": 80000.0, "tipo_inicio": "cliente_activo"}
        },
        headers=superadmin_auth_headers
    )
    gym_id = create_resp.json()["gimnasio"]["id"]

    # 2. Register a payment
    pay_resp = client.post(
        f"/api/v1/admin/gyms/{gym_id}/payments",
        json={
            "monto": 80000.0,
            "meses": 1,
            "metodo": "Efectivo",
            "idempotency_key": "pay-detail-unique-key-1"
        },
        headers=superadmin_auth_headers
    )
    assert pay_resp.status_code == 201

    # 3. Fetch gym detail
    detail_resp = client.get(f"/api/v1/admin/gyms/{gym_id}", headers=superadmin_auth_headers)
    assert detail_resp.status_code == 200
    data = detail_resp.json()

    # Verify RF-07 requirements:
    assert "cuenta_jefe" in data and data["cuenta_jefe"]["correo"] == "mario@detailgym.com"
    assert "suscripcion_actual" in data
    assert "historial_pagos" in data
    assert len(data["historial_pagos"]) == 1
    assert data["historial_pagos"][0]["monto"] == 80000.0
    assert "actividad_reciente" in data
    assert len(data["actividad_reciente"]) >= 1
    assert any("CREACION_GIMNASIO" in a["accion"] for a in data["actividad_reciente"])

def test_idor_manipulated_id_returns_404(client, superadmin_auth_headers):
    """Verifies that queries with nonexistent or forged IDs return 404 cleanly without leakage."""
    resp = client.get("/api/v1/admin/gyms/00000000-0000-0000-0000-000000000000", headers=superadmin_auth_headers)
    assert resp.status_code == 404
