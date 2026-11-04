"""Filtro de membresías por grupo (#8) y revisión de descuadres (GW-RF-10 CA2)."""
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.timezone import today_local
from tests.conftest import ADMIN_URL, Fabrica, login


async def _sql(sentencia: str, **params):
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(text("SET session_replication_role = replica"))
        await con.execute(text(sentencia), params)
    await engine.dispose()


async def _jefe(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    return gym, {"Authorization": f"Bearer {tok}"}


async def _vender(cliente: AsyncClient, headers: dict, plan_id: str, nombre: str) -> str:
    dep = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": nombre, "consentimiento_1581": True},
        headers=headers,
    )
    assert dep.status_code == 201, dep.text
    r = await cliente.post(
        "/api/v1/membresias/asignar",
        json={"deportista_id": dep.json()["id"], "plan_id": plan_id, "pago": {"monto": 50000, "metodo": "efectivo", "tipo_medio": "efectivo"}},
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_grupos_de_membresias_con_total_y_paginacion_correctos(cliente: AsyncClient, fabrica: Fabrica):
    _, headers = await _jefe(cliente, fabrica)
    assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)).status_code == 201
    plan = await cliente.post(
        "/api/v1/planes", json={"nombre": "Mes", "precio": 50000, "duracion_dias": 30, "tipo": "individual"}, headers=headers
    )
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]

    activa = await _vender(cliente, headers, plan_id, "Activa Uno")
    await _vender(cliente, headers, plan_id, "Activa Dos")
    vencida = await _vender(cliente, headers, plan_id, "Vencida")
    cancelada = await _vender(cliente, headers, plan_id, "Cancelada")

    await _sql(
        "UPDATE platform.membresias SET fecha_inicio = current_date - 40, fecha_vencimiento = current_date - 10 WHERE id = :id",
        id=vencida,
    )
    r = await cliente.post(f"/api/v1/membresias/{cancelada}/cancelar", json={"motivo": "Prueba de cancelación"}, headers=headers)
    assert r.status_code == 200, r.text

    async def grupo(nombre: str, **extra):
        res = await cliente.get("/api/v1/membresias", params={"grupo": nombre, **extra}, headers=headers)
        assert res.status_code == 200, res.text
        return res.json()

    activas = await grupo("activas", limit=1)
    assert activas["total"] == 2  # el total no depende de la página
    assert len(activas["items"]) == 1
    assert activas["items"][0]["created_at"]
    assert [m["id"] for m in (await grupo("vencidas"))["items"]] == [vencida]
    assert [m["id"] for m in (await grupo("canceladas"))["items"]] == [cancelada]

    # Una congelada cuenta como activa aunque su fecha ya haya pasado.
    r = await cliente.post(f"/api/v1/membresias/{activa}/congelar", json={"motivo": "Viaje"}, headers=headers)
    assert r.status_code == 201, r.text
    await _sql(
        "UPDATE platform.membresias SET fecha_inicio = current_date - 40, fecha_vencimiento = current_date - 5 WHERE id = :id",
        id=activa,
    )
    assert activa in [m["id"] for m in (await grupo("activas"))["items"]]
    assert activa not in [m["id"] for m in (await grupo("vencidas"))["items"]]


async def _turno_con_faltante(cliente: AsyncClient, headers: dict, contado: int = 5000) -> str:
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 10000}, headers=headers)
    assert r.status_code == 201, r.text
    turno_id = r.json()["id"]
    r = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": contado}, headers=headers)
    assert r.status_code == 200, r.text
    return turno_id


@pytest.mark.asyncio
async def test_el_jefe_revisa_el_descuadre_sin_cambiar_el_arqueo(cliente: AsyncClient, fabrica: Fabrica):
    _, headers = await _jefe(cliente, fabrica)
    turno_id = await _turno_con_faltante(cliente, headers)
    hoy = today_local().isoformat()

    r = await cliente.post(f"/api/v1/caja/turnos/{turno_id}/revision", json={"nota": "Faltó registrar un vale"}, headers=headers)
    assert r.status_code == 204, r.text

    t = (await cliente.get("/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy}, headers=headers)).json()["items"][0]
    assert t["estado_revision"] == "revisado"
    assert t["nota_revision"] == "Faltó registrar un vale"
    assert t["revisado_por_nombre"]
    assert float(t["diferencia"]) == -5000  # el arqueo no cambia

    r = await cliente.post(f"/api/v1/caja/turnos/{turno_id}/revision", json={"nota": "Otra vez"}, headers=headers)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "TURNO_YA_REVISADO"


@pytest.mark.asyncio
async def test_turno_cuadrado_o_ajeno_no_se_revisa(cliente: AsyncClient, fabrica: Fabrica):
    _, headers_a = await _jefe(cliente, fabrica)
    _, headers_b = await _jefe(cliente, fabrica)
    cuadrado = await _turno_con_faltante(cliente, headers_a, contado=10000)
    r = await cliente.post(f"/api/v1/caja/turnos/{cuadrado}/revision", json={"nota": "Sin descuadre"}, headers=headers_a)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "TURNO_SIN_DESCUADRE"

    ajeno = await _turno_con_faltante(cliente, headers_a)
    r = await cliente.post(f"/api/v1/caja/turnos/{ajeno}/revision", json={"nota": "Otro gimnasio"}, headers=headers_b)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_recepcion_no_revisa_descuadres(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    turno_id = await _turno_con_faltante(cliente, headers)
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    tok = (await login(cliente, gym, recepcion)).json()["access_token"]
    r = await cliente.post(
        f"/api/v1/caja/turnos/{turno_id}/revision", json={"nota": "No me toca"}, headers={"Authorization": f"Bearer {tok}"}
    )
    assert r.status_code == 403
