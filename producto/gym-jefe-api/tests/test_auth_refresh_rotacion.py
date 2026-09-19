"""
Tanda 1.5 · punto 3 · Rotación del refresh token por familia (GW-RF-00.1 CA1, GW-RF-00.3 CA1).
Escritas ANTES de tocar el flujo. Corren contra PostgreSQL real.
"""
from sqlalchemy import text

from app.core.database import async_session_maker
from tests.conftest import login


async def _sesiones(staff_id):
    async with async_session_maker() as s:
        res = await s.execute(
            text("""
                SELECT familia_id, rotado_en, revocado_en, expira_en
                FROM platform.sesiones_staff WHERE staff_id = :id ORDER BY created_at
            """),
            {"id": staff_id},
        )
        return [dict(r) for r in res.mappings()]


async def test_refresh_devuelve_refresh_nuevo_y_rota_el_anterior(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    r = await login(cliente, gym, st)
    assert r.status_code == 200, r.text
    refresh_1 = r.json()["refresh_token"]

    r2 = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_1})
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["access_token"]
    assert body.get("refresh_token"), "el refresh debe devolver un refresh nuevo"
    refresh_2 = body["refresh_token"]
    assert refresh_2 != refresh_1

    ses = await _sesiones(st["id"])
    assert len(ses) == 2
    assert ses[0]["rotado_en"] is not None, "el refresh usado queda marcado como rotado"
    assert ses[1]["rotado_en"] is None
    assert ses[0]["familia_id"] == ses[1]["familia_id"], "misma familia"

    # El nuevo sigue sirviendo
    r3 = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_2})
    assert r3.status_code == 200, r3.text


async def test_reusar_refresh_rotado_revoca_la_familia_completa(cliente, fabrica):
    """Prueba 1 del enunciado."""
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    refresh_1 = (await login(cliente, gym, st)).json()["refresh_token"]
    refresh_2 = (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_1})).json()["refresh_token"]

    # Reuso del ya rotado: robo o replay
    r = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_1})
    assert r.status_code == 401
    assert r.json()["error"]["codigo"] == "REFRESH_TOKEN_REUTILIZADO"

    # El vigente de la misma familia también queda fuera
    r2 = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_2})
    assert r2.status_code == 401

    ses = await _sesiones(st["id"])
    assert all(s["revocado_en"] is not None for s in ses), "toda la familia revocada"


async def test_dos_logins_son_familias_independientes(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    fam_a_1 = (await login(cliente, gym, st)).json()["refresh_token"]
    fam_b_1 = (await login(cliente, gym, st)).json()["refresh_token"]
    fam_a_2 = (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": fam_a_1})).json()["refresh_token"]

    # Reuso en la familia A la revoca...
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": fam_a_1})).status_code == 401
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": fam_a_2})).status_code == 401
    # ...pero la familia B sigue viva
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": fam_b_1})).status_code == 200


async def test_logout_revoca_la_familia(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    body = (await login(cliente, gym, st)).json()
    access, refresh_1 = body["access_token"], body["refresh_token"]
    refresh_2 = (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_1})).json()["refresh_token"]

    r = await cliente.post(
        "/api/v1/auth/logout", json={"refresh_token": refresh_2}, headers={"Authorization": f"Bearer {access}"}
    )
    assert r.status_code == 200, r.text

    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_2})).status_code == 401
    ses = await _sesiones(st["id"])
    assert all(s["revocado_en"] is not None for s in ses)


async def test_refresh_inexistente_es_401_generico(cliente, fabrica):
    r = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": "x" * 64})
    assert r.status_code == 401
    assert r.json()["error"]["codigo"] == "REFRESH_TOKEN_INVALIDO"
