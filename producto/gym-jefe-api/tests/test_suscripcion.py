"""
Tanda 1.5 · puntos 5 y 6 · Estado de la suscripción (GW-RF-51) y duración de sesión (GW-RF-48).
"""
from datetime import date, timedelta

import pytest

from tests.conftest import login


def _auth(access: str) -> dict:
    return {"Authorization": f"Bearer {access}"}


def _hoy() -> date:
    return date.today()


@pytest.mark.parametrize(
    "atraso, estado, motivo",
    [
        (4, "bloqueado", "falta_pago"),   # prueba 7 del enunciado
        (2, "en_gracia", None),           # prueba 7 del enunciado
        (1, "en_gracia", None),
        (3, "en_gracia", None),
        (0, "por_vencer", None),
        (-5, "por_vencer", None),
        (-6, "al_dia", None),
    ],
)
async def test_estado_calculado_segun_dias_de_atraso(cliente, fabrica, atraso, estado, motivo):
    gym = await fabrica.crear_gimnasio(estado="activo", fecha_corte=_hoy() - timedelta(days=atraso))
    st = await fabrica.crear_staff(gym)

    r = await login(cliente, gym, st)
    if estado == "bloqueado":
        # Bloqueado: no se valida contraseña, 403 con motivo genérico (GW-RF-51 CA3)
        assert r.status_code == 403, r.text
        assert r.json()["error"]["codigo"] == "GIMNASIO_SUSPENDIDO"
        assert r.json()["error"]["detalles"] == {"motivo": motivo}
        return

    assert r.status_code == 200, r.text
    s = await cliente.get("/api/v1/my-gym/suscripcion", headers=_auth(r.json()["access_token"]))
    assert s.status_code == 200, s.text
    body = s.json()
    assert body["estado_calculado"] == estado
    assert body["dias_restantes"] == -atraso
    assert body["motivo_bloqueo"] == motivo
    assert "valor_mensual" not in body and "deuda" not in body


async def test_prueba_vencida_suspendido_y_cancelado(cliente, fabrica):
    casos = [
        (dict(estado="prueba", fecha_corte=_hoy() - timedelta(days=1)), "prueba_vencida"),
        (dict(estado="suspendido", fecha_corte=_hoy() + timedelta(days=20)), "suspendido"),
        (dict(estado="cancelado", fecha_corte=_hoy() + timedelta(days=20)), "cancelado"),
    ]
    for kwargs, motivo in casos:
        gym = await fabrica.crear_gimnasio(**kwargs)
        st = await fabrica.crear_staff(gym)
        r = await login(cliente, gym, st)
        assert r.status_code == 403 and r.json()["error"]["detalles"]["motivo"] == motivo, (kwargs, r.text)

        # El branding público también responde bloqueado con el mismo motivo, sin datos internos
        b = await cliente.get(f"/api/v1/my-gym/public-branding/{gym.subdominio}")
        assert b.status_code == 403 and b.json()["error"]["codigo"] == "GIMNASIO_SUSPENDIDO"
        assert b.json()["error"]["detalles"] == {"motivo": motivo}


async def test_prueba_vigente_no_bloquea(cliente, fabrica):
    gym = await fabrica.crear_gimnasio(estado="prueba", fecha_corte=_hoy() + timedelta(days=3))
    st = await fabrica.crear_staff(gym)
    r = await login(cliente, gym, st)
    assert r.status_code == 200
    s = (await cliente.get("/api/v1/my-gym/suscripcion", headers=_auth(r.json()["access_token"]))).json()
    assert s["estado_calculado"] == "por_vencer" and s["dias_restantes"] == 3


async def test_bloqueo_se_levanta_con_la_primera_peticion_tras_el_pago(cliente, fabrica):
    """SA-RF-32 CA extra: sin procesos programados; el siguiente intento entra."""
    gym = await fabrica.crear_gimnasio(estado="activo", fecha_corte=_hoy() - timedelta(days=10))
    st = await fabrica.crear_staff(gym)
    assert (await login(cliente, gym, st)).status_code == 403

    # MVC registra el pago: la fecha de corte se mueve (simulado directo en superadmin)
    from sqlalchemy import text
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("UPDATE superadmin.gimnasios SET fecha_corte = current_date + 30 WHERE id = :id"),
            {"id": gym.superadmin_id},
        )
    assert (await login(cliente, gym, st)).status_code == 200


async def test_sesion_vigente_queda_fuera_cuando_el_gimnasio_se_bloquea(cliente, fabrica):
    gym = await fabrica.crear_gimnasio(estado="activo", fecha_corte=_hoy() + timedelta(days=30))
    st = await fabrica.crear_staff(gym)
    body = (await login(cliente, gym, st)).json()

    from sqlalchemy import text
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("UPDATE superadmin.gimnasios SET fecha_corte = current_date - 4 WHERE id = :id"),
            {"id": gym.superadmin_id},
        )

    r = await cliente.get("/api/v1/auth/me", headers=_auth(body["access_token"]))
    assert r.status_code == 403 and r.json()["error"]["codigo"] == "GIMNASIO_SUSPENDIDO"
    r = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 403


async def test_gimnasio_sin_registro_en_superadmin_se_considera_al_dia(cliente, fabrica):
    gym = await fabrica.crear_gimnasio(con_superadmin=False)
    st = await fabrica.crear_staff(gym)
    r = await login(cliente, gym, st)
    assert r.status_code == 200
    s = (await cliente.get("/api/v1/my-gym/suscripcion", headers=_auth(r.json()["access_token"]))).json()
    assert s == {"estado_calculado": "al_dia", "dias_restantes": None, "motivo_bloqueo": None}


async def test_public_branding_distingue_inexistente_de_bloqueado(cliente, fabrica):
    r = await cliente.get("/api/v1/my-gym/public-branding/no-existe-t15")
    assert r.status_code == 404 and r.json()["error"]["codigo"] == "GIMNASIO_NO_ENCONTRADO"

    inactivo = await fabrica.crear_gimnasio(activo=False, estado="suspendido")
    r = await cliente.get(f"/api/v1/my-gym/public-branding/{inactivo.subdominio}")
    assert r.status_code == 403 and r.json()["error"]["codigo"] == "GIMNASIO_SUSPENDIDO"

    ok = await fabrica.crear_gimnasio(fecha_corte=_hoy() + timedelta(days=30))
    r = await cliente.get(f"/api/v1/my-gym/public-branding/{ok.subdominio}")
    assert r.status_code == 200
    assert r.json()["nombre"] == ok.nombre and r.json()["primary_color"] == "#123456"
