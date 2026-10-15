import pytest
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from httpx import AsyncClient

from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_crear_staff_genera_credencial_temporal_72h(cliente: AsyncClient, fabrica: Fabrica):
    """
    GW-RF-39 / Contrato 2.7:
    - POST /personal no requiere contraseña y genera password_temporal con expiración a 72 h.
    - El nuevo staff puede ingresar con esa credencial y su flag debe_cambiar_password es True.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok_jefe = (await login(cliente, gym, jefe)).json()["access_token"]
    headers_jefe = {"Authorization": f"Bearer {tok_jefe}"}

    # 1. Crear recepcionista sin contraseña
    r_crear = await cliente.post(
        "/api/v1/personal",
        json={
            "nombre": "Ana Recepcionista",
            "correo": "ana_recep@gymtest.com",
            "rol": "recepcionista"
        },
        headers=headers_jefe
    )
    assert r_crear.status_code == 201, r_crear.text
    data_crear = r_crear.json()

    assert data_crear["nombre"] == "Ana Recepcionista"
    assert data_crear["correo"] == "ana_recep@gymtest.com"
    assert data_crear["password_temporal"] is not None
    assert len(data_crear["password_temporal"]) >= 8
    assert data_crear["expira_en"] is not None
    assert data_crear["debe_cambiar_password"] is True

    pwd_temp = data_crear["password_temporal"]

    # 2. Login con la contraseña temporal
    r_login = await cliente.post(
        "/api/v1/auth/login",
        json={
            "subdominio": gym.subdominio,
            "correo": "ana_recep@gymtest.com",
            "password": pwd_temp
        }
    )
    assert r_login.status_code == 200, r_login.text
    data_login = r_login.json()
    assert data_login["usuario"]["debe_cambiar_password"] is True
    assert data_login["usuario"]["password_temporal_expira_en"] is not None

    tok_ana = data_login["access_token"]
    headers_ana = {"Authorization": f"Bearer {tok_ana}"}

    # 3. Cambiar contraseña obligatoria
    r_chg = await cliente.post(
        "/api/v1/auth/cambiar-password",
        json={
            "password_actual": pwd_temp,
            "password_nueva": "Clave-Definitiva-2026!"
        },
        headers=headers_ana
    )
    assert r_chg.status_code == 200, r_chg.text

    # 4. Verificar en /auth/me que ya no debe cambiarla
    r_me = await cliente.get("/api/v1/auth/me", headers=headers_ana)
    assert r_me.status_code == 200
    me = r_me.json()
    assert me["debe_cambiar_password"] is False
    assert me["password_temporal_expira_en"] is None


@pytest.mark.asyncio
async def test_regenerar_credencial_staff_exito_y_revocacion(cliente: AsyncClient, fabrica: Fabrica):
    """
    GW-RF-39 / Contrato 2.7:
    - POST /personal/{id}/regenerar-credencial genera nueva temporal a 72 h.
    - Cierra las sesiones activas del usuario afectado.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok_jefe = (await login(cliente, gym, jefe)).json()["access_token"]
    headers_jefe = {"Authorization": f"Bearer {tok_jefe}"}

    # 1. Crear entrenador
    r_crear = await cliente.post(
        "/api/v1/personal",
        json={
            "nombre": "Carlos Coach",
            "correo": "carlos_coach@gymtest.com",
            "rol": "entrenador"
        },
        headers=headers_jefe
    )
    assert r_crear.status_code == 201
    coach_id = r_crear.json()["id"]
    pwd_ini = r_crear.json()["password_temporal"]

    # 2. Coach inicia sesión y obtiene tokens
    r_log1 = await cliente.post(
        "/api/v1/auth/login",
        json={
            "subdominio": gym.subdominio,
            "correo": "carlos_coach@gymtest.com",
            "password": pwd_ini
        }
    )
    assert r_log1.status_code == 200
    refresh_token_coach = r_log1.json()["refresh_token"]

    # 3. Jefe regenera credencial
    r_regen = await cliente.post(
        f"/api/v1/personal/{coach_id}/regenerar-credencial",
        headers=headers_jefe
    )
    assert r_regen.status_code == 200, r_regen.text
    data_regen = r_regen.json()
    assert "password_temporal" in data_regen
    assert "expira_en" in data_regen
    nueva_pwd = data_regen["password_temporal"]
    assert nueva_pwd != pwd_ini

    # 4. El refresh token anterior del coach ahora debe fallar (sesión revocada)
    r_ref = await cliente.post(
        "/api/v1/auth/refresh",
        json={"subdominio": gym.subdominio, "refresh_token": refresh_token_coach}
    )
    assert r_ref.status_code == 401

    # 5. La clave anterior ya no sirve
    r_bad_log = await cliente.post(
        "/api/v1/auth/login",
        json={"subdominio": gym.subdominio, "correo": "carlos_coach@gymtest.com", "password": pwd_ini}
    )
    assert r_bad_log.status_code == 401

    # 6. La nueva clave temporal sí permite login
    r_new_log = await cliente.post(
        "/api/v1/auth/login",
        json={"subdominio": gym.subdominio, "correo": "carlos_coach@gymtest.com", "password": nueva_pwd}
    )
    assert r_new_log.status_code == 200
    assert r_new_log.json()["usuario"]["debe_cambiar_password"] is True


@pytest.mark.asyncio
async def test_regenerar_credencial_permisos_y_errores(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que solo el Jefe puede regenerar credenciales y que IDs inexistentes dan 404.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    coach = await fabrica.crear_staff(gym, rol="entrenador")

    tok_jefe = (await login(cliente, gym, jefe)).json()["access_token"]
    tok_coach = (await login(cliente, gym, coach)).json()["access_token"]

    # 1. Coach intenta regenerar credencial -> 403 ROL_NO_AUTORIZADO
    r_coach = await cliente.post(
        f"/api/v1/personal/{coach['id']}/regenerar-credencial",
        headers={"Authorization": f"Bearer {tok_coach}"}
    )
    assert r_coach.status_code == 403
    assert r_coach.json()["error"]["codigo"] == "ROL_NO_AUTORIZADO"

    # 2. Jefe intenta regenerar con ID inexistente -> 404 STAFF_NO_ENCONTRADO
    r_404 = await cliente.post(
        f"/api/v1/personal/{uuid4()}/regenerar-credencial",
        headers={"Authorization": f"Bearer {tok_jefe}"}
    )
    assert r_404.status_code == 404
    assert r_404.json()["error"]["codigo"] == "STAFF_NO_ENCONTRADO"
