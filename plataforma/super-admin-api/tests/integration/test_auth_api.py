from app.core.config import settings

def test_login_successful(client, test_superadmin):
    response = client.post(
        "/api/v1/auth/login",
        json={"correo": test_superadmin.correo, "password": "SuperSecret123!"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["usuario"]["correo"] == test_superadmin.correo

def test_login_invalid_password(client, test_superadmin):
    response = client.post(
        "/api/v1/auth/login",
        json={"correo": test_superadmin.correo, "password": "WrongPassword!"}
    )
    assert response.status_code == 401

def test_login_lockout_after_max_attempts(client, test_superadmin):
    # Attempt failed logins up to MAX_LOGIN_ATTEMPTS
    for _ in range(settings.MAX_LOGIN_ATTEMPTS):
        client.post(
            "/api/v1/auth/login",
            json={"correo": test_superadmin.correo, "password": "WrongPassword!"}
        )
    
    # Next attempt should return 423 Locked
    locked_resp = client.post(
        "/api/v1/auth/login",
        json={"correo": test_superadmin.correo, "password": "SuperSecret123!"}
    )
    assert locked_resp.status_code == 423
    assert "bloqueada" in locked_resp.json()["message"].lower()

def test_get_current_user_profile(client, superadmin_auth_headers, test_superadmin):
    response = client.get("/api/v1/auth/me", headers=superadmin_auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == test_superadmin.id

def test_login_user_not_found(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"correo": "noexiste@gymos.internal", "password": "AnyPassword123!"}
    )
    assert response.status_code == 401

def test_invalid_token_rejected(client):
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer token_completamente_invalido_y_falso"}
    )
    assert response.status_code == 401

def test_expired_token_rejected(client, expired_auth_headers):
    response = client.get(
        "/api/v1/auth/me",
        headers=expired_auth_headers
    )
    assert response.status_code == 401
    assert "expirado" in response.json().get("detail", "").lower()

def test_logout_and_token_revocation(client, superadmin_auth_headers):
    # 1. Access protected endpoint before logout
    check_resp = client.get("/api/v1/auth/me", headers=superadmin_auth_headers)
    assert check_resp.status_code == 200

    # 2. Call logout
    logout_resp = client.post("/api/v1/auth/logout", headers=superadmin_auth_headers)
    assert logout_resp.status_code == 200
    assert "revocado" in logout_resp.json().get("mensaje", "").lower()

    # 3. Attempt to access again with revoked token
    retry_resp = client.get("/api/v1/auth/me", headers=superadmin_auth_headers)
    assert retry_resp.status_code == 401
    assert "revocado" in retry_resp.json().get("detail", "").lower()

def test_password_recovery_and_reset_flow(client, db_session, test_superadmin):
    # 1. Request recovery
    rec_resp = client.post(
        "/api/v1/auth/recovery",
        json={"correo": test_superadmin.correo}
    )
    assert rec_resp.status_code == 200

    # 2. Fetch the generated recovery token from DB
    from app.infrastructure.models.superadmin_models import TokenRecuperacion
    rec_record = db_session.query(TokenRecuperacion).filter(
        TokenRecuperacion.usuario_id == test_superadmin.id
    ).order_by(TokenRecuperacion.created_at.desc()).first()
    assert rec_record is not None

    # 3. Reset password using use case
    from app.application.use_cases.auth_use_cases import AuthUseCases
    use_cases = AuthUseCases(db_session)
    raw_token = use_cases.request_password_recovery(test_superadmin.correo)
    assert len(raw_token) >= 32  # Cryptographic strength verified

    reset_resp = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "nueva_password": "NewSecretPassword2026!"}
    )
    assert reset_resp.status_code == 200

    # 4. Login with new password
    login_new = client.post(
        "/api/v1/auth/login",
        json={"correo": test_superadmin.correo, "password": "NewSecretPassword2026!"}
    )
    assert login_new.status_code == 200

