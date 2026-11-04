"""Ajustes del 4-nov: la pantalla se abre desde la sesión y las medidas no usan una edad supuesta."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.modules.pantalla_tv.service import PantallaTvService
from tests.conftest import Fabrica, login


async def _jefe(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    return gym, {"Authorization": f"Bearer {tok}"}, tok


async def _validar(subdominio: str, token: str):
    from app.core.database import async_session_maker

    async with async_session_maker() as s:
        return await PantallaTvService.validar_device_token(s, subdominio, token)


@pytest.mark.asyncio
async def test_token_de_sesion_abre_la_pantalla_solo_de_su_gimnasio(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers, tok_login = await _jefe(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()

    r = await cliente.post("/api/v1/pantalla-tv/sesion", headers=headers)
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    assert (await _validar(gym.subdominio, token))["id"] == gym.id
    assert await _validar(otro.subdominio, token) is None
    # El token de inicio de sesión no sirve como credencial de pantalla.
    assert await _validar(gym.subdominio, tok_login) is None
    assert await _validar(gym.subdominio, "cualquier-cosa") is None


@pytest.mark.asyncio
async def test_token_vencido_o_falsificado_no_abre(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _ = await _jefe(cliente, fabrica)
    ahora = datetime.now(timezone.utc)
    base = {"typ": "pantalla_tv", "gid": str(gym.id)}
    vencido = jwt.encode({**base, "exp": ahora - timedelta(minutes=1)}, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    falso = jwt.encode({**base, "exp": ahora + timedelta(hours=1)}, "otra-clave-" * 4, algorithm=settings.JWT_ALGORITHM)
    assert await _validar(gym.subdominio, vencido) is None
    assert await _validar(gym.subdominio, falso) is None


@pytest.mark.asyncio
async def test_sesion_de_pantalla_exige_permiso(cliente: AsyncClient, fabrica: Fabrica):
    assert (await cliente.post("/api/v1/pantalla-tv/sesion")).status_code == 401


async def _medir(cliente: AsyncClient, headers: dict, **dep) -> dict:
    d = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Ana", "consentimiento_1581": True, **dep},
        headers=headers,
    )
    assert d.status_code == 201, d.text
    return d.json()


@pytest.mark.asyncio
async def test_sin_fecha_de_nacimiento_no_se_supone_una_edad(cliente: AsyncClient, fabrica: Fabrica):
    _, headers, _ = await _jefe(cliente, fabrica)
    sin_fecha = await _medir(cliente, headers)
    url = f"/api/v1/deportistas/{sin_fecha['id']}/mediciones"

    # Solo con peso, el cálculo necesitaría la edad: no se inventa.
    r = await cliente.post(url, json={"peso": 62, "sexo": "F", "altura_cm": 165}, headers=headers)
    assert r.status_code == 201, r.text
    assert r.json()["grasa_pct"] is None

    # Con cintura se calcula sin necesitar la edad.
    r = await cliente.post(url, json={"cintura": 72}, headers=headers)
    assert r.status_code == 201, r.text
    assert r.json()["grasa_pct"] is not None

    con_fecha = await _medir(cliente, headers, fecha_nacimiento="1995-05-10")
    r = await cliente.post(
        f"/api/v1/deportistas/{con_fecha['id']}/mediciones", json={"peso": 62, "sexo": "F", "altura_cm": 165}, headers=headers
    )
    assert r.json()["grasa_pct"] is not None


@pytest.mark.asyncio
async def test_la_pantalla_no_recibe_negados_ni_documento(cliente: AsyncClient, fabrica: Fabrica, monkeypatch):
    from app.modules.pantalla_tv.manager import PantallaTvConnectionManager

    enviados = []

    async def capturar(gym_id, payload):
        enviados.append(payload)

    monkeypatch.setattr(PantallaTvConnectionManager, "broadcast_to_gym", capturar)
    # El servidor real lo registra al arrancar; aquí no hay arranque.
    from app.modules.control_ingreso.service import ControlIngresoService

    monkeypatch.setattr(ControlIngresoService, "_listeners_checkin", [PantallaTvConnectionManager.on_checkin_event])
    _, headers, _ = await _jefe(cliente, fabrica)
    assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)).status_code == 201

    sin_plan = await _medir(cliente, headers, nombre="Pedro Negado")
    r = await cliente.post("/api/v1/control-ingreso/checkin-manual", json={"documento": sin_plan["documento"]}, headers=headers)
    assert r.json()["resultado"] == "negado"
    assert [e for e in enviados if e.get("tipo") == "CHECKIN_EVENTO"] == []

    con_pase = await _medir(cliente, headers, nombre="Carolina Pase")
    v = await cliente.post(
        "/api/v1/caja/ventas",
        json={
            "deportista_id": con_pase["id"],
            "metodo": "efectivo",
            "tipo_medio": "efectivo",
            "items": [{"tipo": "pase_dia", "descripcion": "Pase", "cantidad": 1, "precio_unitario": 15000}],
        },
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert v.status_code == 201, v.text
    r = await cliente.post("/api/v1/control-ingreso/checkin-manual", json={"documento": con_pase["documento"]}, headers=headers)
    assert r.json()["resultado"] == "abrio"
    eventos = [e for e in enviados if e.get("tipo") == "CHECKIN_EVENTO"]
    assert len(eventos) == 1
    assert eventos[0]["deportista"]["nombre"] == "Carolina Pase"
    assert "documento" not in eventos[0]["deportista"]
