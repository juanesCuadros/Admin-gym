"""Turno de trabajo separado de la caja (decisión de Juan del 4-nov-2026)."""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.timezone import today_local
from tests.conftest import ADMIN_URL, Fabrica, login

URL = "/api/v1/turnos-trabajo"
HOY = lambda: today_local().isoformat()


async def _sql(sentencia: str, **params):
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(text("SET session_replication_role = replica"))
        await con.execute(text(sentencia), params)
    await engine.dispose()


async def _token(cliente: AsyncClient, gym, staff) -> dict:
    return {"Authorization": f"Bearer {(await login(cliente, gym, staff)).json()['access_token']}"}


async def _equipo(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    entrenador = await fabrica.crear_staff(gym, rol="entrenador")
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    return gym, {
        "jefe": (jefe, await _token(cliente, gym, jefe)),
        "entrenador": (entrenador, await _token(cliente, gym, entrenador)),
        "recepcion": (recepcion, await _token(cliente, gym, recepcion)),
    }


@pytest.mark.asyncio
async def test_varias_personas_en_turno_a_la_vez_sin_abrir_caja(cliente: AsyncClient, fabrica: Fabrica):
    _, e = await _equipo(cliente, fabrica)
    for rol in ("jefe", "entrenador", "recepcion"):
        r = await cliente.post(f"{URL}/entrada", headers=e[rol][1])
        assert r.status_code == 201, r.text
    assert (await cliente.get(f"{URL}/mio", headers=e["entrenador"][1])).json()["abierto"]["staff_rol"] == "entrenador"
    # La caja sigue cerrada: el turno de trabajo no la abre.
    assert (await cliente.get("/api/v1/caja/turnos/actual", headers=e["jefe"][1])).status_code == 404


@pytest.mark.asyncio
async def test_una_misma_persona_no_abre_dos_ni_cierra_sin_abrir(cliente: AsyncClient, fabrica: Fabrica):
    _, e = await _equipo(cliente, fabrica)
    h = e["entrenador"][1]
    r = await cliente.post(f"{URL}/salida", headers=h)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "SIN_TURNO_TRABAJO_ABIERTO"
    assert (await cliente.post(f"{URL}/entrada", headers=h)).status_code == 201
    r = await cliente.post(f"{URL}/entrada", headers=h)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "TURNO_TRABAJO_YA_ABIERTO"


@pytest.mark.asyncio
async def test_calcula_las_horas_de_cada_persona(cliente: AsyncClient, fabrica: Fabrica):
    _, e = await _equipo(cliente, fabrica)
    entrenador, h_ent = e["entrenador"]
    recepcion, h_rec = e["recepcion"]
    turno = (await cliente.post(f"{URL}/entrada", headers=h_ent)).json()
    await _sql("UPDATE platform.turnos_trabajo SET entrada_en = now() - interval '2 hours 30 minutes' WHERE id = :id", id=turno["id"])
    r = await cliente.post(f"{URL}/salida", headers=h_ent)
    assert r.status_code == 200, r.text
    assert r.json()["minutos"] == 150
    assert (await cliente.get(f"{URL}/mio", headers=h_ent)).json()["minutos_hoy"] == 150

    await cliente.post(f"{URL}/entrada", headers=h_rec)  # sigue abierto

    d = (await cliente.get(URL, params={"desde": HOY(), "hasta": HOY()}, headers=e["jefe"][1])).json()
    assert d["total"] == 2
    resumen = {p["staff_id"]: p for p in d["resumen"]}
    assert resumen[str(entrenador["id"])]["minutos"] == 150
    # El abierto no suma horas todavía, pero se ve.
    assert resumen[str(recepcion["id"])]["minutos"] == 0
    assert resumen[str(recepcion["id"])]["abiertos"] == 1

    d = (await cliente.get(URL, params={"desde": HOY(), "hasta": HOY(), "staff_id": str(entrenador["id"])}, headers=e["jefe"][1])).json()
    assert d["total"] == 1


@pytest.mark.asyncio
async def test_el_jefe_cierra_un_turno_olvidado(cliente: AsyncClient, fabrica: Fabrica):
    _, e = await _equipo(cliente, fabrica)
    h_jefe = e["jefe"][1]
    turno = (await cliente.post(f"{URL}/entrada", headers=e["entrenador"][1])).json()
    await _sql("UPDATE platform.turnos_trabajo SET entrada_en = now() - interval '10 hours' WHERE id = :id", id=turno["id"])
    ahora = datetime.now(timezone.utc)

    url = f"{URL}/{turno['id']}/cerrar"
    assert (await cliente.post(url, json={"salida_en": (ahora - timedelta(hours=2)).isoformat(), "motivo": "x"}, headers=h_jefe)).status_code == 422
    for hora in (ahora + timedelta(hours=1), ahora - timedelta(hours=20)):
        r = await cliente.post(url, json={"salida_en": hora.isoformat(), "motivo": "Olvidó marcar"}, headers=h_jefe)
        assert r.status_code == 422
        assert r.json()["error"]["codigo"] == "HORA_SALIDA_INVALIDA"
    assert (await cliente.post(url, json={"salida_en": ahora.isoformat(), "motivo": "Olvidó marcar"}, headers=e["recepcion"][1])).status_code == 403

    r = await cliente.post(url, json={"salida_en": (ahora - timedelta(hours=2)).isoformat(), "motivo": "Olvidó marcar"}, headers=h_jefe)
    assert r.status_code == 200, r.text
    assert r.json()["minutos"] == 480
    assert r.json()["motivo_cierre"] == "Olvidó marcar"
    assert r.json()["cerrado_por_nombre"]
    r = await cliente.post(url, json={"salida_en": ahora.isoformat(), "motivo": "Otra vez"}, headers=h_jefe)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_permisos_y_aislamiento(cliente: AsyncClient, fabrica: Fabrica):
    _, e = await _equipo(cliente, fabrica)
    _, otro = await _equipo(cliente, fabrica)
    params = {"desde": HOY(), "hasta": HOY()}
    assert (await cliente.get(URL, params=params)).status_code == 401
    assert (await cliente.post(f"{URL}/entrada")).status_code == 401
    assert (await cliente.get(URL, params=params, headers=e["entrenador"][1])).status_code == 403

    turno = (await cliente.post(f"{URL}/entrada", headers=e["entrenador"][1])).json()
    assert (await cliente.get(URL, params=params, headers=otro["jefe"][1])).json()["total"] == 0
    r = await cliente.post(
        f"{URL}/{turno['id']}/cerrar",
        json={"salida_en": datetime.now(timezone.utc).isoformat(), "motivo": "Otro gimnasio"},
        headers=otro["jefe"][1],
    )
    assert r.status_code == 404
    r = await cliente.get(URL, params={"desde": HOY(), "hasta": (today_local() - timedelta(days=1)).isoformat()}, headers=e["jefe"][1])
    assert r.status_code == 422
