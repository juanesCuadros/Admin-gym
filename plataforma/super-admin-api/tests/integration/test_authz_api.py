import pytest
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.security import get_password_hash, create_access_token

def test_inactive_superadmin_user_forbidden(client, db_session):
    # Create inactive user
    inactive_user = UsuarioInterno(
        nombre="Inactive Admin",
        correo="inactive@gymos.internal",
        hash_password=get_password_hash("SecretPass123!"),
        rol="superadmin",
        activo=False
    )
    db_session.add(inactive_user)
    db_session.commit()

    token = create_access_token(
        subject=inactive_user.id,
        email=inactive_user.correo,
        role=inactive_user.rol
    )
    headers = {"Authorization": f"Bearer {token}"}

    # Attempt to access protected endpoint
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 403
    error_msg = (response.json().get("detail") or response.json().get("message", "")).lower()
    assert "inactivo" in error_msg


def test_tenant_staff_cannot_access_superadmin_endpoints(client, tenant_staff_auth_headers):
    """
    Ensures that a tenant staff member (e.g. role 'jefe') is strictly forbidden
    from accessing Super-Admin operations.
    """
    # 1. Attempt dashboard metrics
    resp_dash = client.get("/api/v1/admin/dashboard/metrics", headers=tenant_staff_auth_headers)
    assert resp_dash.status_code in [401, 403]

    # 2. Attempt listing gyms
    resp_gyms = client.get("/api/v1/admin/gyms", headers=tenant_staff_auth_headers)
    assert resp_gyms.status_code in [401, 403]

    # 3. Attempt audit inspection
    resp_audit = client.get("/api/v1/admin/audit", headers=tenant_staff_auth_headers)
    assert resp_audit.status_code in [401, 403]

def test_superadmin_authorized_for_global_operations(client, superadmin_auth_headers):
    """
    Verifies that a valid Super Admin operator has full authorized access to global operations.
    """
    resp_dash = client.get("/api/v1/admin/dashboard/metrics", headers=superadmin_auth_headers)
    assert resp_dash.status_code == 200

    resp_gyms = client.get("/api/v1/admin/gyms", headers=superadmin_auth_headers)
    assert resp_gyms.status_code == 200

    resp_exercises = client.get("/api/v1/admin/exercises", headers=superadmin_auth_headers)
    assert resp_exercises.status_code == 200
