"""B3 · X-Idempotency-Key en abrir y cerrar turno, egresos y anulaciones: un doble envío no duplica nada."""
import asyncio
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import ADMIN_URL, Fabrica, login


async def _contar(sentencia: str, **params) -> int:
    engine = create_async_engine(ADMIN_URL)
    async with engine.connect() as con:
        n = (await con.execute(text(sentencia), params)).scalar_one()
    await engine.dispose()
    return n


async def _auditorias(gym_id, accion: str) -> int:
    return await _contar(
        "SELECT count(*) FROM platform.auditoria_gym WHERE gimnasio_id = :g AND accion = :a", g=gym_id, a=accion
    )


async def _headers(cliente: AsyncClient, gym, staff) -> dict:
    tok = (await login(cliente, gym, staff)).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _con_clave(headers: dict, clave: str) -> dict:
    return {**headers, "X-Idempotency-Key": clave}


async def _jefe(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    return gym, await _headers(cliente, gym, jefe)


async def _abrir(cliente: AsyncClient, headers: dict, base: int = 50000, clave=None):
    return await cliente.post(
        "/api/v1/caja/turnos/abrir", json={"base_inicial": base}, headers=_con_clave(headers, clave or str(uuid4()))
    )


async def _turno(cliente: AsyncClient, headers: dict) -> dict:
    return (await cliente.get("/api/v1/caja/turnos/actual", headers=headers)).json()


@pytest.mark.asyncio
async def test_abrir_turno_dos_veces_con_la_misma_clave_abre_uno(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    clave = str(uuid4())
    r1 = await _abrir(cliente, headers, clave=clave)
    r2 = await _abrir(cliente, headers, base=99999, clave=clave)
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    assert r1.json()["id"] == r2.json()["id"]
    assert float(r2.json()["base_inicial"]) == 50000  # manda el original, no el reintento
    assert await _contar("SELECT count(*) FROM platform.turnos_caja WHERE gimnasio_id = :g", g=gym.id) == 1
    assert await _auditorias(gym.id, "ABRIR_TURNO_CAJA") == 1


@pytest.mark.asyncio
async def test_abrir_turno_simultaneo_con_la_misma_clave(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    clave = str(uuid4())
    r1, r2 = await asyncio.gather(_abrir(cliente, headers, clave=clave), _abrir(cliente, headers, clave=clave))
    assert {r1.status_code, r2.status_code} == {201}, (r1.text, r2.text)
    assert r1.json()["id"] == r2.json()["id"]
    assert await _contar("SELECT count(*) FROM platform.turnos_caja WHERE gimnasio_id = :g", g=gym.id) == 1
    assert await _auditorias(gym.id, "ABRIR_TURNO_CAJA") == 1


@pytest.mark.asyncio
async def test_sin_clave_se_comporta_como_antes(cliente: AsyncClient, fabrica: Fabrica):
    _, headers = await _jefe(cliente, fabrica)
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 1000}, headers=headers)
    assert r.status_code == 201, r.text
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 1000}, headers=headers)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "TURNO_YA_ABIERTO"
    # Otra clave nueva sobre un turno ya abierto sigue rechazándose: la clave no salta la regla del turno único.
    r = await _abrir(cliente, headers)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "TURNO_YA_ABIERTO"


@pytest.mark.asyncio
async def test_egreso_repetido_y_simultaneo_se_registra_una_vez(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    assert (await _abrir(cliente, headers)).status_code == 201
    clave = str(uuid4())
    cuerpo = {"monto": 12000, "motivo": "Compra de jabón"}

    async def egreso():
        return await cliente.post("/api/v1/caja/egresos", json=cuerpo, headers=_con_clave(headers, clave))

    r1, r2 = await asyncio.gather(egreso(), egreso())
    r3 = await egreso()
    assert {r1.status_code, r2.status_code, r3.status_code} == {201}, (r1.text, r2.text, r3.text)
    assert r1.json()["id"] == r2.json()["id"] == r3.json()["id"]
    assert await _contar("SELECT count(*) FROM platform.egresos_caja WHERE gimnasio_id = :g", g=gym.id) == 1
    assert await _auditorias(gym.id, "REGISTRAR_EGRESO_CAJA") == 1
    t = await _turno(cliente, headers)
    assert float(t["egresos_efectivo"]) == 12000
    assert float(t["total_esperado_efectivo"]) == 38000

    # Una clave distinta es otro egreso.
    r = await cliente.post("/api/v1/caja/egresos", json=cuerpo, headers=_con_clave(headers, str(uuid4())))
    assert r.status_code == 201
    assert await _contar("SELECT count(*) FROM platform.egresos_caja WHERE gimnasio_id = :g", g=gym.id) == 2


@pytest.mark.asyncio
async def test_cerrar_turno_repetido_devuelve_el_mismo_cierre(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    assert (await _abrir(cliente, headers)).status_code == 201
    clave_egreso = str(uuid4())
    r = await cliente.post(
        "/api/v1/caja/egresos", json={"monto": 5000, "motivo": "Hielo"}, headers=_con_clave(headers, clave_egreso)
    )
    assert r.status_code == 201
    egreso_id = r.json()["id"]

    clave = str(uuid4())
    r1 = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 45000}, headers=_con_clave(headers, clave))
    r2 = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 1}, headers=_con_clave(headers, clave))
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json()["id"] == r2.json()["id"]
    assert r2.json()["estado"] == "cerrado"
    assert float(r2.json()["efectivo_contado"]) == 45000
    assert float(r2.json()["diferencia"]) == 0
    assert await _auditorias(gym.id, "CERRAR_TURNO_CAJA") == 1

    # El egreso reenviado después del cierre devuelve el original, no un 404 ni un egreso nuevo.
    r = await cliente.post(
        "/api/v1/caja/egresos", json={"monto": 5000, "motivo": "Hielo"}, headers=_con_clave(headers, clave_egreso)
    )
    assert r.status_code == 201
    assert r.json()["id"] == egreso_id

    # Sin clave, el segundo cierre sigue diciendo que no hay turno abierto.
    r = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 1}, headers=headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_cerrar_turno_simultaneo_con_la_misma_clave(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    assert (await _abrir(cliente, headers)).status_code == 201
    clave = str(uuid4())

    async def cerrar():
        return await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 50000}, headers=_con_clave(headers, clave))

    r1, r2 = await asyncio.gather(cerrar(), cerrar())
    assert {r1.status_code, r2.status_code} == {200}, (r1.text, r2.text)
    assert r1.json()["id"] == r2.json()["id"]
    assert await _auditorias(gym.id, "CERRAR_TURNO_CAJA") == 1


@pytest.mark.asyncio
async def test_cierre_ajeno_y_forzado_repetidos(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    recep = await fabrica.crear_staff(gym, rol="recepcionista")
    h_jefe = await _headers(cliente, gym, jefe)
    h_recep = await _headers(cliente, gym, recep)

    # Cierre ajeno: el jefe cierra el turno de recepción dos veces con la misma clave.
    r = await _abrir(cliente, h_recep)
    turno_id = r.json()["id"]
    clave = str(uuid4())
    url = f"/api/v1/caja/turnos/{turno_id}/cerrar-ajeno"
    r1 = await cliente.post(url, json={"conteo_efectivo": 48000, "nota": "Lo dejó abierto"}, headers=_con_clave(h_jefe, clave))
    r2 = await cliente.post(url, json={"conteo_efectivo": 48000, "nota": "Lo dejó abierto"}, headers=_con_clave(h_jefe, clave))
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r2.json()["descuadre_atribuido_a_nombre"] == "Staff recepcionista"
    assert float(r2.json()["diferencia"]) == -2000
    assert await _auditorias(gym.id, "CERRAR_TURNO_AJENO") == 1

    # Cierre forzado del Jefe, repetido.
    r = await _abrir(cliente, h_recep)
    turno2 = r.json()["id"]
    clave2 = str(uuid4())
    url2 = f"/api/v1/caja/turnos/{turno2}/cierre-forzado"
    r1 = await cliente.post(url2, json={"motivo": "Se fue sin cerrar"}, headers=_con_clave(h_jefe, clave2))
    r2 = await cliente.post(url2, json={"motivo": "Se fue sin cerrar"}, headers=_con_clave(h_jefe, clave2))
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r2.json()["cierre_forzado"] is True
    assert await _auditorias(gym.id, "CIERRE_FORZADO_TURNO") == 1

    # La clave que cerró un turno no sirve para cerrar otro.
    r = await _abrir(cliente, h_recep)
    r = await cliente.post(
        f"/api/v1/caja/turnos/{r.json()['id']}/cierre-forzado", json={"motivo": "Otro"}, headers=_con_clave(h_jefe, clave2)
    )
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "CLAVE_IDEMPOTENCIA_EN_USO"


async def _producto(gym_id, stock: int = 10) -> str:
    pid = uuid4()
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(
            text("""
                INSERT INTO platform.productos (id, gimnasio_id, nombre, precio, stock, activo)
                VALUES (:id, :g, 'Agua', 3000, :stock, true)
            """),
            {"id": pid, "g": gym_id, "stock": stock},
        )
    await engine.dispose()
    return str(pid)


@pytest.mark.asyncio
async def test_anular_venta_dos_veces_devuelve_una_vez(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    assert (await _abrir(cliente, headers)).status_code == 201
    pid = await _producto(gym.id)

    async def vender():
        r = await cliente.post(
            "/api/v1/caja/ventas",
            json={
                "metodo": "Efectivo",
                "tipo_medio": "efectivo",
                "items": [{"tipo": "producto", "producto_id": pid, "descripcion": "Agua", "cantidad": 2}],
            },
            headers=_con_clave(headers, str(uuid4())),
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    venta_id = await vender()
    otra_venta = await vender()
    clave = str(uuid4())
    cuerpo = {"motivo": "Cliente se arrepintió", "tipo_medio_reembolso": "efectivo"}
    url = f"/api/v1/caja/ventas/{venta_id}/anular"
    r1, r2 = await asyncio.gather(
        cliente.post(url, json=cuerpo, headers=_con_clave(headers, clave)),
        cliente.post(url, json=cuerpo, headers=_con_clave(headers, clave)),
    )
    r3 = await cliente.post(url, json=cuerpo, headers=_con_clave(headers, clave))
    assert {r1.status_code, r2.status_code, r3.status_code} == {200}, (r1.text, r2.text, r3.text)
    assert await _contar("SELECT count(*) FROM platform.devoluciones WHERE venta_original_id = :v", v=venta_id) == 1
    assert await _contar("SELECT stock FROM platform.productos WHERE id = :p", p=pid) == 8  # 10 - 2 - 2 + 2
    assert await _auditorias(gym.id, "ANULAR_VENTA") == 1
    t = await _turno(cliente, headers)
    assert float(t["devoluciones_efectivo"]) == 6000

    # Sin clave, anular otra vez la misma venta sigue siendo un error.
    r = await cliente.post(url, json=cuerpo, headers=headers)
    assert r.status_code == 400
    assert r.json()["error"]["codigo"] == "VENTA_YA_ANULADA"

    # La misma clave sobre otra venta se rechaza y no la anula.
    r = await cliente.post(f"/api/v1/caja/ventas/{otra_venta}/anular", json=cuerpo, headers=_con_clave(headers, clave))
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "CLAVE_IDEMPOTENCIA_EN_USO"
    assert await _contar("SELECT count(*) FROM platform.ventas WHERE id = :v AND anulada", v=otra_venta) == 0


@pytest.mark.asyncio
async def test_anular_pago_de_membresia_dos_veces_devuelve_una_vez(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    assert (await _abrir(cliente, headers)).status_code == 201
    plan = await cliente.post(
        "/api/v1/planes",
        json={"nombre": f"Plan {uuid4().hex[:5]}", "precio": 80000, "duracion_dias": 30, "tipo": "individual"},
        headers=headers,
    )
    dep = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Cliente", "consentimiento_1581": True},
        headers=headers,
    )
    r = await cliente.post(
        "/api/v1/membresias/asignar",
        json={
            "deportista_id": dep.json()["id"],
            "plan_id": plan.json()["id"],
            "pago": {"monto": 80000, "metodo": "Efectivo", "tipo_medio": "efectivo"},
        },
        headers=_con_clave(headers, str(uuid4())),
    )
    assert r.status_code == 201, r.text
    pago_id = r.json()["pago"]["id"]

    clave = str(uuid4())
    url = f"/api/v1/caja/pagos-membresia/{pago_id}/anular"
    r1, r2 = await asyncio.gather(
        cliente.post(url, json={"motivo": "Cobro por error"}, headers=_con_clave(headers, clave)),
        cliente.post(url, json={"motivo": "Cobro por error"}, headers=_con_clave(headers, clave)),
    )
    assert {r1.status_code, r2.status_code} == {200}, (r1.text, r2.text)
    assert await _contar("SELECT count(*) FROM platform.devoluciones WHERE pago_membresia_id = :p", p=pago_id) == 1
    assert await _auditorias(gym.id, "ANULAR_PAGO_MEMBRESIA") == 1
    t = await _turno(cliente, headers)
    assert float(t["devoluciones_efectivo"]) == 80000
