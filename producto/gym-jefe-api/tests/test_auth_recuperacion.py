"""
Tanda 1.5 · punto 2 · Recuperación de contraseña (GW-RF-00.2). PostgreSQL real.
El enlace se captura del log del adaptador de correo en modo `log`.
"""
import logging
import re

from sqlalchemy import text

from app.core.database import async_session_maker
from tests.conftest import login

ENLACE = re.compile(r"/recuperar/([A-Za-z0-9_\-]+)")


async def _solicitar(cliente, gym, correo):
    return await cliente.post("/api/v1/auth/recuperar-password/solicitar", json={"subdominio": gym.subdominio, "correo": correo})


def _token_del_log(caplog) -> str:
    enlaces = [m.group(1) for r in caplog.records if r.name == "gymos.email" for m in [ENLACE.search(r.getMessage())] if m]
    assert enlaces, "el correo con el enlace no salió al log"
    return enlaces[-1]


async def test_respuesta_identica_para_valido_inexistente_y_desactivado(cliente, fabrica):
    """Prueba 2 del enunciado."""
    gym = await fabrica.crear_gimnasio()
    valido = await fabrica.crear_staff(gym)
    desactivado = await fabrica.crear_staff(gym, activo=False)

    r_valido = await _solicitar(cliente, gym, valido["correo"])
    r_inexistente = await _solicitar(cliente, gym, "nadie-" + valido["correo"])
    r_desactivado = await _solicitar(cliente, gym, desactivado["correo"])

    assert r_valido.status_code == r_inexistente.status_code == r_desactivado.status_code == 200
    assert r_valido.json() == r_inexistente.json() == r_desactivado.json()

    # Solo el válido generó token; el desactivado no
    async with async_session_maker() as s:
        n = await s.execute(
            text("SELECT staff_id, COUNT(*) FROM platform.tokens_recuperacion_staff WHERE staff_id IN (:a, :b) GROUP BY staff_id"),
            {"a": valido["id"], "b": desactivado["id"]},
        )
        conteo = {str(r[0]): r[1] for r in n.all()}
    assert conteo.get(str(valido["id"])) == 1
    assert str(desactivado["id"]) not in conteo


async def test_token_vence_en_una_hora_y_se_envia_por_correo(cliente, fabrica, caplog):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)
    with caplog.at_level(logging.INFO, logger="gymos.email"):
        assert (await _solicitar(cliente, gym, st["correo"])).status_code == 200
    token = _token_del_log(caplog)
    assert len(token) >= 32

    async with async_session_maker() as s:
        res = await s.execute(
            text("SELECT EXTRACT(EPOCH FROM (expira_en - created_at)) FROM platform.tokens_recuperacion_staff WHERE staff_id = :id"),
            {"id": st["id"]},
        )
        segundos = float(res.scalar())
    assert 3590 <= segundos <= 3610, f"vigencia de {segundos}s; debe ser 1 h"

    r = await cliente.get(f"/api/v1/auth/recuperar-password/validar/{token}")
    assert r.status_code == 200 and r.json() == {"valido": True}


async def test_pedir_token_nuevo_invalida_el_anterior(cliente, fabrica, caplog):
    """Prueba 4 del enunciado."""
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)
    with caplog.at_level(logging.INFO, logger="gymos.email"):
        await _solicitar(cliente, gym, st["correo"])
        token_1 = _token_del_log(caplog)
        caplog.clear()
        await _solicitar(cliente, gym, st["correo"])
        token_2 = _token_del_log(caplog)
    assert token_1 != token_2

    assert (await cliente.get(f"/api/v1/auth/recuperar-password/validar/{token_1}")).json() == {"valido": False}
    assert (await cliente.get(f"/api/v1/auth/recuperar-password/validar/{token_2}")).json() == {"valido": True}

    r = await cliente.post("/api/v1/auth/recuperar-password/confirmar", json={"token": token_1, "nueva_password": "Otra-Clave-456"})
    assert r.status_code == 400 and r.json()["error"]["codigo"] == "TOKEN_INVALIDO_O_EXPIRADO"


async def test_token_usado_dos_veces_se_rechaza_y_cierra_todas_las_sesiones(cliente, fabrica, caplog):
    """Prueba 3 del enunciado + CA3 (cierra todas las sesiones)."""
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)
    refresh_a = (await login(cliente, gym, st)).json()["refresh_token"]
    refresh_b = (await login(cliente, gym, st)).json()["refresh_token"]

    with caplog.at_level(logging.INFO, logger="gymos.email"):
        await _solicitar(cliente, gym, st["correo"])
    token = _token_del_log(caplog)

    r1 = await cliente.post("/api/v1/auth/recuperar-password/confirmar", json={"token": token, "nueva_password": "Nueva-Clave-789"})
    assert r1.status_code == 200, r1.text
    r2 = await cliente.post("/api/v1/auth/recuperar-password/confirmar", json={"token": token, "nueva_password": "Nueva-Clave-789"})
    assert r2.status_code == 400 and r2.json()["error"]["codigo"] == "TOKEN_INVALIDO_O_EXPIRADO"

    # Validar tampoco lo acepta ya
    assert (await cliente.get(f"/api/v1/auth/recuperar-password/validar/{token}")).json() == {"valido": False}

    # Todas las sesiones previas quedaron cerradas
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_a})).status_code == 401
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_b})).status_code == 401

    # La contraseña nueva sirve; la vieja no
    assert (await login(cliente, gym, st, password="Nueva-Clave-789")).status_code == 200
    assert (await login(cliente, gym, st)).status_code == 401


async def test_validar_token_desconocido_no_revela_nada(cliente):
    r = await cliente.get("/api/v1/auth/recuperar-password/validar/tokenquenoexiste123456")
    assert r.status_code == 200 and r.json() == {"valido": False}


async def test_gimnasio_inexistente_y_bloqueado(cliente, fabrica):
    r = await cliente.post("/api/v1/auth/recuperar-password/solicitar", json={"subdominio": "no-existe-t15", "correo": "a@b.co"})
    assert r.status_code == 404 and r.json()["error"]["codigo"] == "GIMNASIO_NO_ENCONTRADO"

    gym = await fabrica.crear_gimnasio(activo=False, estado="suspendido")
    r = await cliente.post("/api/v1/auth/recuperar-password/solicitar", json={"subdominio": gym.subdominio, "correo": "a@b.co"})
    assert r.status_code == 403 and r.json()["error"]["codigo"] == "GIMNASIO_SUSPENDIDO"
