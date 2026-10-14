import pytest
from uuid import uuid4
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_recepcionista_sin_turno_abierto_requiere_abrir_caja_true(cliente: AsyncClient, fabrica: Fabrica):
    """
    GW-RF-00.1 CA4 / Contrato 2.8:
    - Recepcionista sin turno abierto en el gimnasio recibe requiere_abrir_caja = True en GET /auth/me y login.
    """
    gym = await fabrica.crear_gimnasio()
    recep = await fabrica.crear_staff(gym, rol="recepcionista")

    # 1. Login
    res_login = await login(cliente, gym, recep)
    assert res_login.status_code == 200, res_login.text
    assert res_login.json()["usuario"]["requiere_abrir_caja"] is True

    tok = res_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # 2. GET /auth/me
    res_me = await cliente.get("/api/v1/auth/me", headers=headers)
    assert res_me.status_code == 200
    assert res_me.json()["requiere_abrir_caja"] is True


@pytest.mark.asyncio
async def test_recepcionista_con_turno_abierto_requiere_abrir_caja_false(cliente: AsyncClient, fabrica: Fabrica):
    """
    GW-RF-00.1 CA4 / Contrato 2.8:
    - Si existe un turno abierto en el gimnasio, requiere_abrir_caja es False para la recepcionista.
    """
    gym = await fabrica.crear_gimnasio()
    recep = await fabrica.crear_staff(gym, rol="recepcionista")

    # Insertar turno abierto en platform.turnos_caja
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO platform.turnos_caja (id, gimnasio_id, staff_id, base_inicial, estado, abierto_en)
                VALUES (:id, :gym, :staff, 50000, 'abierto', now())
            """),
            {"id": uuid4(), "gym": gym.id, "staff": recep["id"]}
        )

    # Login y GET /auth/me
    res_login = await login(cliente, gym, recep)
    assert res_login.status_code == 200
    assert res_login.json()["usuario"]["requiere_abrir_caja"] is False

    tok = res_login.json()["access_token"]
    res_me = await cliente.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert res_me.status_code == 200
    assert res_me.json()["requiere_abrir_caja"] is False


@pytest.mark.asyncio
async def test_recepcionista_con_turno_cerrado_requiere_abrir_caja_true(cliente: AsyncClient, fabrica: Fabrica):
    """
    Si los turnos previos están cerrados, requiere_abrir_caja vuelve a ser True.
    """
    gym = await fabrica.crear_gimnasio()
    recep = await fabrica.crear_staff(gym, rol="recepcionista")

    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO platform.turnos_caja (id, gimnasio_id, staff_id, base_inicial, estado, abierto_en, cerrado_en)
                VALUES (:id, :gym, :staff, 50000, 'cerrado', now() - interval '2 hours', now() - interval '1 hour')
            """),
            {"id": uuid4(), "gym": gym.id, "staff": recep["id"]}
        )

    res_login = await login(cliente, gym, recep)
    assert res_login.status_code == 200
    assert res_login.json()["usuario"]["requiere_abrir_caja"] is True

    tok = res_login.json()["access_token"]
    res_me = await cliente.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert res_me.status_code == 200
    assert res_me.json()["requiere_abrir_caja"] is True


@pytest.mark.asyncio
async def test_jefe_y_entrenador_nunca_requieren_abrir_caja(cliente: AsyncClient, fabrica: Fabrica):
    """
    GW-RF-00.1 CA4:
    - Jefe y Entrenador nunca tienen requiere_abrir_caja = True, aún sin ningún turno en el gimnasio.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    coach = await fabrica.crear_staff(gym, rol="entrenador")

    # 1. Jefe
    res_jefe = await login(cliente, gym, jefe)
    assert res_jefe.status_code == 200
    assert res_jefe.json()["usuario"]["requiere_abrir_caja"] is False
    tok_jefe = res_jefe.json()["access_token"]
    me_jefe = await cliente.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok_jefe}"})
    assert me_jefe.json()["requiere_abrir_caja"] is False

    # 2. Entrenador
    res_coach = await login(cliente, gym, coach)
    assert res_coach.status_code == 200
    assert res_coach.json()["usuario"]["requiere_abrir_caja"] is False
    tok_coach = res_coach.json()["access_token"]
    me_coach = await cliente.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok_coach}"})
    assert me_coach.json()["requiere_abrir_caja"] is False
