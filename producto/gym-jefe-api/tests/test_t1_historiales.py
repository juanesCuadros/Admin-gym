"""Tanda 1: historial de ingresos por fechas (#2) e historial de turnos (#6)."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.timezone import today_local
from tests.conftest import ADMIN_URL, Fabrica, login


async def _jefe(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    return gym, jefe, {"Authorization": f"Bearer {tok}"}


async def _sql(sentencia: str, **params):
    """Mueve fechas de datos de prueba: la API no permite registrar en el pasado."""
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(text("SET session_replication_role = replica"))
        await con.execute(text(sentencia), params)
    await engine.dispose()


async def _cortesia(cliente: AsyncClient, headers: dict):
    r = await cliente.post("/api/v1/control-ingreso/cortesia", json={"motivo": "Prueba de historial"}, headers=headers)
    assert r.status_code in (200, 201), r.text
    return r.json()


async def _cerrar_turno(cliente: AsyncClient, headers: dict, base: int, contado: int) -> str:
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": base}, headers=headers)
    assert r.status_code == 201, r.text
    turno_id = r.json()["id"]
    r = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": contado}, headers=headers)
    assert r.status_code == 200, r.text
    return turno_id


# ---------- Historial de ingresos ----------
@pytest.mark.asyncio
async def test_historial_filtra_por_dias_de_bogota(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    hoy = today_local()
    antiguo = await _cortesia(cliente, headers)
    await _cortesia(cliente, headers)
    # 04:30 UTC de hoy todavía es ayer en Bogotá: debe contar en el día de ayer.
    await _sql(
        "UPDATE platform.checkins SET ts_utc = :ts WHERE id = :id",
        ts=datetime(hoy.year, hoy.month, hoy.day, 4, 30, tzinfo=timezone.utc),
        id=antiguo["checkin_id"],
    )

    r = await cliente.get(
        "/api/v1/control-ingreso/historial", params={"desde": hoy.isoformat(), "hasta": hoy.isoformat()}, headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["resumen"]["total_registros"] == 1

    ayer = (hoy - timedelta(days=1)).isoformat()
    r = await cliente.get("/api/v1/control-ingreso/historial", params={"desde": ayer, "hasta": ayer}, headers=headers)
    assert [i["id"] for i in r.json()["items"]] == [antiguo["checkin_id"]]

    r = await cliente.get(
        "/api/v1/control-ingreso/historial", params={"desde": ayer, "hasta": hoy.isoformat()}, headers=headers
    )
    assert r.json()["resumen"]["total_registros"] == 2
    assert r.json()["resumen"]["cortesias"] == 2


@pytest.mark.asyncio
async def test_historial_pagina_y_rechaza_rango_invertido(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    hoy = today_local().isoformat()
    for _ in range(3):
        await _cortesia(cliente, headers)

    r = await cliente.get(
        "/api/v1/control-ingreso/historial", params={"desde": hoy, "hasta": hoy, "limit": 2, "offset": 2}, headers=headers
    )
    assert r.json()["resumen"]["total_registros"] == 3
    assert len(r.json()["items"]) == 1

    manana = (today_local() + timedelta(days=1)).isoformat()
    r = await cliente.get("/api/v1/control-ingreso/historial", params={"desde": manana, "hasta": hoy}, headers=headers)
    assert r.status_code == 422
    assert r.json()["error"]["codigo"] == "RANGO_FECHAS_INVALIDO"


@pytest.mark.asyncio
async def test_historial_no_mezcla_gimnasios(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers_a = await _jefe(cliente, fabrica)
    _, _, headers_b = await _jefe(cliente, fabrica)
    hoy = today_local().isoformat()
    await _cortesia(cliente, headers_a)

    r = await cliente.get("/api/v1/control-ingreso/historial", params={"desde": hoy, "hasta": hoy}, headers=headers_b)
    assert r.json()["resumen"]["total_registros"] == 0
    assert r.json()["items"] == []


@pytest.mark.asyncio
async def test_historial_exige_permiso(cliente: AsyncClient):
    r = await cliente.get("/api/v1/control-ingreso/historial", params={"desde": "2026-01-01", "hasta": "2026-01-02"})
    assert r.status_code == 401


# ---------- Historial de turnos ----------
@pytest.mark.asyncio
async def test_turnos_trae_arqueo_y_filtra_descuadre(cliente: AsyncClient, fabrica: Fabrica):
    _, jefe, headers = await _jefe(cliente, fabrica)
    hoy = today_local().isoformat()
    cuadrado = await _cerrar_turno(cliente, headers, base=50000, contado=50000)
    con_faltante = await _cerrar_turno(cliente, headers, base=50000, contado=45000)

    r = await cliente.get("/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy}, headers=headers)
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["total"] == 2
    assert [t["id"] for t in cuerpo["items"]] == [con_faltante, cuadrado]
    faltante = cuerpo["items"][0]
    assert float(faltante["total_esperado_efectivo"]) == 50000
    assert float(faltante["efectivo_contado"]) == 45000
    assert float(faltante["diferencia"]) == -5000
    assert faltante["staff_id"] == str(jefe["id"])
    assert faltante["staff_nombre"]

    r = await cliente.get(
        "/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy, "con_descuadre": True}, headers=headers
    )
    assert [t["id"] for t in r.json()["items"]] == [con_faltante]


@pytest.mark.asyncio
async def test_turnos_no_lista_el_abierto_y_filtra_por_persona_y_pagina(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers = await _jefe(cliente, fabrica)
    hoy = today_local().isoformat()
    await _cerrar_turno(cliente, headers, base=0, contado=0)
    await _cerrar_turno(cliente, headers, base=0, contado=0)
    await _cerrar_turno(cliente, headers, base=0, contado=0)
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)
    assert r.status_code == 201, r.text

    r = await cliente.get("/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy, "limite": 2, "pagina": 2}, headers=headers)
    cuerpo = r.json()
    assert cuerpo["total"] == 3
    assert cuerpo["total_paginas"] == 2
    assert len(cuerpo["items"]) == 1

    r = await cliente.get(
        "/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy, "staff_id": str(jefe["id"])}, headers=headers
    )
    assert r.json()["total"] == 3
    r = await cliente.get("/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy, "staff_id": str(uuid4())}, headers=headers)
    assert r.json()["total"] == 0


@pytest.mark.asyncio
async def test_turnos_filtra_por_fecha_de_apertura(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    hoy = today_local()
    turno = await _cerrar_turno(cliente, headers, base=0, contado=0)
    await _sql(
        "UPDATE platform.turnos_caja SET abierto_en = abierto_en - interval '3 days', "
        "cerrado_en = cerrado_en - interval '3 days' WHERE id = :id",
        id=turno,
    )

    r = await cliente.get("/api/v1/caja/turnos", params={"desde": hoy.isoformat(), "hasta": hoy.isoformat()}, headers=headers)
    assert r.json()["total"] == 0

    inicio = (hoy - timedelta(days=4)).isoformat()
    r = await cliente.get("/api/v1/caja/turnos", params={"desde": inicio, "hasta": hoy.isoformat()}, headers=headers)
    assert [t["id"] for t in r.json()["items"]] == [turno]


@pytest.mark.asyncio
async def test_turnos_no_mezcla_gimnasios_y_rechaza_rango_invertido(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers_a = await _jefe(cliente, fabrica)
    _, _, headers_b = await _jefe(cliente, fabrica)
    hoy = today_local().isoformat()
    await _cerrar_turno(cliente, headers_a, base=0, contado=0)

    r = await cliente.get("/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy}, headers=headers_b)
    assert r.json()["total"] == 0

    manana = (today_local() + timedelta(days=1)).isoformat()
    r = await cliente.get("/api/v1/caja/turnos", params={"desde": manana, "hasta": hoy}, headers=headers_a)
    assert r.status_code == 422
    assert r.json()["error"]["codigo"] == "RANGO_FECHAS_INVALIDO"
