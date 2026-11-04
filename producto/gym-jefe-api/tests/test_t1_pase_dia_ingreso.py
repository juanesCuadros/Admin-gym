"""Decisión de Juan (4-nov): el pase de día permite entrar ese día."""
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import ADMIN_URL, Fabrica, login


async def _sql(sentencia: str, **params):
    """Mueve fechas de datos de prueba: la API no permite registrar en el pasado."""
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(text("SET session_replication_role = replica"))
        await con.execute(text(sentencia), params)
    await engine.dispose()


async def _preparar(cliente: AsyncClient, fabrica: Fabrica) -> dict:
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)
    assert r.status_code == 201, r.text
    return headers


async def _persona(cliente: AsyncClient, headers: dict) -> dict:
    r = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Visitante", "consentimiento_1581": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _vender(cliente: AsyncClient, headers: dict, deportista_id: str, tipo: str = "pase_dia") -> dict:
    r = await cliente.post(
        "/api/v1/caja/ventas",
        json={
            "deportista_id": deportista_id,
            "metodo": "efectivo",
            "tipo_medio": "efectivo",
            "items": [{"tipo": tipo, "descripcion": "Pase", "cantidad": 1, "precio_unitario": 15000}],
        },
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _validar(cliente: AsyncClient, headers: dict, documento: str) -> dict:
    r = await cliente.post("/api/v1/control-ingreso/checkin-manual", json={"documento": documento}, headers=headers)
    assert r.status_code in (200, 201), r.text
    return r.json()


async def _salir_de_la_relectura(deportista_id: str):
    """Dos validaciones en menos de 3 segundos cuentan como una sola."""
    await _sql(
        "UPDATE platform.checkins SET ts_utc = ts_utc - interval '1 minute' WHERE deportista_id = :d", d=deportista_id
    )


@pytest.mark.asyncio
async def test_sin_pase_se_niega_y_con_pase_de_hoy_entra(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _preparar(cliente, fabrica)
    p = await _persona(cliente, headers)
    assert (await _validar(cliente, headers, p["documento"]))["resultado"] == "negado"

    await _vender(cliente, headers, p["id"])
    await _salir_de_la_relectura(p["id"])
    r = await _validar(cliente, headers, p["documento"])
    assert r["resultado"] == "abrio"
    assert r["comando_torniquete"] is True
    assert "pase de día" in r["mensaje"]


@pytest.mark.asyncio
async def test_puede_reingresar_el_mismo_dia(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _preparar(cliente, fabrica)
    p = await _persona(cliente, headers)
    await _vender(cliente, headers, p["id"])
    assert (await _validar(cliente, headers, p["documento"]))["resultado"] == "abrio"
    r = await cliente.post("/api/v1/control-ingreso/salida", json={"deportista_id": p["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    await _salir_de_la_relectura(p["id"])
    assert (await _validar(cliente, headers, p["documento"]))["resultado"] == "abrio"


@pytest.mark.asyncio
async def test_el_pase_de_ayer_ya_no_sirve(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _preparar(cliente, fabrica)
    p = await _persona(cliente, headers)
    venta = await _vender(cliente, headers, p["id"])
    await _sql("UPDATE platform.ventas SET created_at = created_at - interval '1 day' WHERE id = :id", id=venta["id"])
    assert (await _validar(cliente, headers, p["documento"]))["resultado"] == "negado"


@pytest.mark.asyncio
async def test_el_pase_anulado_no_sirve(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _preparar(cliente, fabrica)
    p = await _persona(cliente, headers)
    venta = await _vender(cliente, headers, p["id"])
    r = await cliente.post(
        f"/api/v1/caja/ventas/{venta['id']}/anular",
        json={"motivo": "Se arrepintió del pase", "tipo_medio_reembolso": "efectivo"},
        headers=headers,
    )
    assert r.status_code in (200, 201), r.text
    assert (await _validar(cliente, headers, p["documento"]))["resultado"] == "negado"


@pytest.mark.asyncio
async def test_el_pase_de_otra_persona_o_de_clase_no_sirve(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _preparar(cliente, fabrica)
    con_pase = await _persona(cliente, headers)
    sin_pase = await _persona(cliente, headers)
    con_pase_clase = await _persona(cliente, headers)
    await _vender(cliente, headers, con_pase["id"])
    await _vender(cliente, headers, con_pase_clase["id"], tipo="pase_clase")
    assert (await _validar(cliente, headers, sin_pase["documento"]))["resultado"] == "negado"
    assert (await _validar(cliente, headers, con_pase_clase["documento"]))["resultado"] == "negado"


@pytest.mark.asyncio
async def test_al_desactivado_se_le_sigue_negando(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _preparar(cliente, fabrica)
    p = await _persona(cliente, headers)
    await _vender(cliente, headers, p["id"])
    await _sql("UPDATE platform.deportistas SET activo = false WHERE id = :id", id=p["id"])
    r = await _validar(cliente, headers, p["documento"])
    assert r["resultado"] == "negado"
    assert r["comando_torniquete"] is False
