"""Pendiente #11 · Cambio de contraseña con sesión (SA-RF-00.2 CA3: cierra todas las sesiones del usuario)."""
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings

CAMBIAR = "/api/v1/auth/cambiar-password"
ME = "/api/v1/auth/me"


def _token_anterior(admin) -> str:
    """Token de una sesión abierta hace un minuto (otro navegador)."""
    ahora = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(admin.id), "email": admin.correo, "role": admin.rol, "type": "access_token",
            "iat": int((ahora - timedelta(minutes=1)).timestamp()),
            "exp": int((ahora + timedelta(minutes=30)).timestamp()),
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def test_cambiar_password_cierra_las_demas_sesiones(pg_client, pg_admin):
    otra_sesion = {"Authorization": f"Bearer {_token_anterior(pg_admin)}"}
    assert pg_client.get(ME, headers=otra_sesion).status_code == 200

    r = pg_client.post(CAMBIAR, headers=otra_sesion, json={
        "password_actual": "ClaveSegura2026!", "password_nueva": "OtraClave2026!"})
    assert r.status_code == 200, r.text
    nuevo = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # La sesión vieja queda cerrada; la del token nuevo sigue.
    assert pg_client.get(ME, headers=otra_sesion).status_code == 401
    assert pg_client.get(ME, headers=nuevo).status_code == 200

    # La contraseña nueva es la que sirve para entrar.
    login = "/api/v1/auth/login"
    assert pg_client.post(login, json={"correo": pg_admin.correo, "password": "ClaveSegura2026!"}).status_code == 401
    assert pg_client.post(login, json={"correo": pg_admin.correo, "password": "OtraClave2026!"}).status_code == 200


def test_rechaza_actual_incorrecta_y_nueva_igual(pg_client, pg_headers):
    r = pg_client.post(CAMBIAR, headers=pg_headers, json={"password_actual": "NoEsLaClave1", "password_nueva": "OtraClave2026!"})
    assert r.status_code == 422
    assert r.json()["codigo"] == "PASSWORD_ACTUAL_INCORRECTA"

    r = pg_client.post(CAMBIAR, headers=pg_headers, json={"password_actual": "ClaveSegura2026!", "password_nueva": "ClaveSegura2026!"})
    assert r.status_code == 422
    assert r.json()["codigo"] == "PASSWORD_IGUAL_A_ACTUAL"

    r = pg_client.post(CAMBIAR, headers=pg_headers, json={"password_actual": "ClaveSegura2026!", "password_nueva": "corta"})
    assert r.status_code == 422


def test_sin_sesion_no_cambia(pg_client):
    r = pg_client.post(CAMBIAR, json={"password_actual": "x", "password_nueva": "OtraClave2026!"})
    assert r.status_code in (401, 403)
