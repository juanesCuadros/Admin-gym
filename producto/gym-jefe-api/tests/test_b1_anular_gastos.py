"""B1 · Anular gastos: motivo, auditoría, idempotencia y el efectivo vuelve al turno abierto (P-11)."""
import asyncio
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.timezone import today_local
from tests.conftest import ADMIN_URL, Fabrica, login

HOY = lambda: today_local().isoformat()  # noqa: E731


async def _sql(sentencia: str, **params):
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        res = await con.execute(text(sentencia), params)
        filas = [dict(f) for f in res.mappings().all()] if res.returns_rows else []
    await engine.dispose()
    return filas


async def _headers(cliente: AsyncClient, gym, staff) -> dict:
    return {"Authorization": f"Bearer {(await login(cliente, gym, staff)).json()['access_token']}"}


async def _jefe(cliente: AsyncClient, fabrica: Fabrica, turno: bool = True):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    h = await _headers(cliente, gym, jefe)
    if turno:
        assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 100000}, headers=h)).status_code == 201
    return gym, h


async def _gasto(cliente: AsyncClient, h: dict, metodo="transferencia", monto=50000) -> dict:
    r = await cliente.post(
        "/api/v1/gastos",
        json={"categoria": "Arriendo", "beneficiario_tipo": "externo", "beneficiario_nombre": "Don Pedro", "metodo": metodo, "monto": monto},
        headers={**h, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _anular(cliente: AsyncClient, h: dict, gasto_id: str, motivo="Se registró dos veces", clave=None):
    return await cliente.post(
        f"/api/v1/gastos/{gasto_id}/anular", json={"motivo": motivo}, headers={**h, "X-Idempotency-Key": clave or str(uuid4())}
    )


async def _turno(cliente: AsyncClient, h: dict) -> dict:
    return (await cliente.get("/api/v1/caja/turnos/actual", headers=h)).json()


async def _auditorias(gym_id, accion: str) -> int:
    return (await _sql("SELECT count(*) n FROM platform.auditoria_gym WHERE gimnasio_id = :g AND accion = :a", g=gym_id, a=accion))[0]["n"]


@pytest.mark.asyncio
async def test_anular_transferencia_deja_de_contar_y_queda_auditado(cliente: AsyncClient, fabrica: Fabrica):
    gym, h = await _jefe(cliente, fabrica, turno=False)
    g = await _gasto(cliente, h)
    await _gasto(cliente, h, monto=20000)
    r = await _anular(cliente, h, g["id"])
    assert r.status_code == 200, r.text
    assert r.json()["anulado"] is True and r.json()["motivo_anulacion"] == "Se registró dos veces"
    assert r.json()["anulado_por_nombre"] and r.json()["turno_reintegro_id"] is None

    listado = (await cliente.get("/api/v1/gastos", params={"desde": HOY(), "hasta": HOY()}, headers=h)).json()
    assert listado["total"] == 2  # sigue en la lista, marcado
    assert float(listado["suma"]) == 20000
    resultado = (await cliente.get("/api/v1/gastos/resultado", params={"desde": HOY(), "hasta": HOY()}, headers=h)).json()
    assert float(resultado["gastos"]) == 20000
    assert await _auditorias(gym.id, "ANULAR_GASTO") == 1

    r = await _anular(cliente, h, g["id"])
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "GASTO_YA_ANULADO"
    r = await _anular(cliente, h, g["id"], motivo="  ab ")
    assert r.status_code in (409, 422)


@pytest.mark.asyncio
async def test_el_efectivo_vuelve_al_turno_abierto_y_el_turno_cerrado_no_cambia(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    recep = await fabrica.crear_staff(gym, rol="recepcionista")
    hj, hr = await _headers(cliente, gym, jefe), await _headers(cliente, gym, recep)
    assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 100000}, headers=hj)).status_code == 201
    g = await _gasto(cliente, hj, metodo="efectivo", monto=30000)
    t1 = await _turno(cliente, hj)
    assert float(t1["total_esperado_efectivo"]) == 70000
    cierre = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 70000}, headers=hj)
    assert cierre.status_code == 200

    # Sin turno abierto no se puede: el efectivo no tendría a dónde volver.
    r = await _anular(cliente, hj, g["id"])
    assert r.status_code == 400 and r.json()["error"]["codigo"] == "NO_HAY_TURNO_ABIERTO"
    assert (await _sql("SELECT anulado FROM platform.gastos WHERE id = :g", g=g["id"]))[0]["anulado"] is False

    # Recepción abre su turno; el Jefe anula y el efectivo vuelve a ese turno.
    assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 10000}, headers=hr)).status_code == 201
    r = await _anular(cliente, hj, g["id"], motivo="El proveedor devolvió el dinero")
    assert r.status_code == 200, r.text
    t2 = await _turno(cliente, hr)
    assert r.json()["turno_reintegro_id"] == t2["id"]
    assert float(t2["reintegros_efectivo"]) == 30000
    assert float(t2["total_esperado_efectivo"]) == 40000
    movs = (await cliente.get(f"/api/v1/caja/turnos/{t2['id']}/movimientos", headers=hr)).json()["items"]
    assert any(m["tipo_movimiento"] == "reintegro" and float(m["monto"]) == 30000 for m in movs)

    # P-11: el turno cerrado conserva su arqueo y su efectivo esperado.
    viejo = (await _sql("SELECT efectivo_contado, diferencia FROM platform.turnos_caja WHERE id = :t", t=t1["id"]))[0]
    assert float(viejo["efectivo_contado"]) == 70000 and float(viejo["diferencia"]) == 0
    hoy = HOY()
    cerrados = (await cliente.get("/api/v1/caja/turnos", params={"desde": hoy, "hasta": hoy}, headers=hj)).json()["items"]
    assert float(next(t for t in cerrados if t["id"] == t1["id"])["total_esperado_efectivo"]) == 70000


@pytest.mark.asyncio
async def test_doble_envio_no_devuelve_dos_veces(cliente: AsyncClient, fabrica: Fabrica):
    gym, h = await _jefe(cliente, fabrica)
    g = await _gasto(cliente, h, metodo="efectivo", monto=12000)
    otro = await _gasto(cliente, h, metodo="efectivo", monto=5000)
    clave = str(uuid4())
    r1, r2 = await asyncio.gather(_anular(cliente, h, g["id"], clave=clave), _anular(cliente, h, g["id"], clave=clave))
    r3 = await _anular(cliente, h, g["id"], clave=clave)
    assert {r1.status_code, r2.status_code, r3.status_code} == {200}, (r1.text, r2.text)
    assert (await _sql("SELECT count(*) n FROM platform.reintegros_caja WHERE gasto_id = :g", g=g["id"]))[0]["n"] == 1
    assert await _auditorias(gym.id, "ANULAR_GASTO") == 1
    assert float((await _turno(cliente, h))["reintegros_efectivo"]) == 12000
    r = await _anular(cliente, h, otro["id"], clave=clave)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "CLAVE_IDEMPOTENCIA_EN_USO"
    r = await cliente.post(f"/api/v1/gastos/{g['id']}/anular", json={"motivo": "Sin clave"}, headers=h)
    assert r.status_code == 422  # la clave es obligatoria


@pytest.mark.asyncio
async def test_permisos_y_pago_a_entrenador(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    recep = await fabrica.crear_staff(gym, rol="recepcionista")
    entrenador = await fabrica.crear_staff(gym, rol="entrenador")
    hj, hr = await _headers(cliente, gym, jefe), await _headers(cliente, gym, recep)
    g = await _gasto(cliente, hj)

    # Sin el permiso de gastos, recepción no puede (por defecto solo el Jefe).
    r = await _anular(cliente, hr, g["id"])
    assert r.status_code == 403

    # Con gastos:eliminar habilitado en la matriz, sí; pero el pago a un entrenador sigue siendo del Jefe.
    await _sql("""INSERT INTO platform.permisos_rol (gimnasio_id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar)
                  VALUES (:g, 'recepcionista', 'gastos', true, true, false, true)
                  ON CONFLICT (gimnasio_id, rol, submodulo) DO UPDATE SET puede_eliminar = true""", g=gym.id)
    await cliente.put(f"/api/v1/gastos/entrenadores/{entrenador['id']}/config", json={"esquema": "fijo", "valor": 500000}, headers=hj)
    pago = await cliente.post(
        f"/api/v1/gastos/entrenadores/{entrenador['id']}/pagos",
        json={"desde": HOY(), "hasta": HOY(), "monto": 200000, "metodo": "transferencia"},
        headers={**hj, "X-Idempotency-Key": str(uuid4())},
    )
    assert pago.status_code == 201, pago.text
    r = await _anular(cliente, hr, pago.json()["gasto_id"])
    assert r.status_code == 403 and r.json()["error"]["codigo"] == "SOLO_JEFE"
    assert (await _anular(cliente, hr, g["id"])).status_code == 200

    # Anulado por el Jefe, el pago deja de contar como pagado en la liquidación.
    liq = lambda: cliente.get("/api/v1/gastos/entrenadores", params={"desde": HOY(), "hasta": HOY()}, headers=hj)  # noqa: E731
    assert float((await liq()).json()[0]["pagado"]) == 200000
    assert (await _anular(cliente, hj, pago.json()["gasto_id"], motivo="Pago duplicado")).status_code == 200
    assert float((await liq()).json()[0]["pagado"]) == 0


@pytest.mark.asyncio
async def test_gasto_de_otro_gimnasio_es_404(cliente: AsyncClient, fabrica: Fabrica):
    _, h1 = await _jefe(cliente, fabrica, turno=False)
    _, h2 = await _jefe(cliente, fabrica, turno=False)
    g = await _gasto(cliente, h1)
    r = await _anular(cliente, h2, g["id"])
    assert r.status_code == 404 and r.json()["error"]["codigo"] == "GASTO_NO_ENCONTRADO"


@pytest.mark.asyncio
async def test_el_efectivo_no_vuelve_a_un_turno_de_estacion(cliente: AsyncClient, fabrica: Fabrica):
    """Un turno abierto en una estación (escritorio) no es la caja de la web: el reintegro solo va al turno de la web."""
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    recep = await fabrica.crear_staff(gym, rol="recepcionista")
    h = await _headers(cliente, gym, jefe)

    # El gasto en efectivo sale de un turno web que luego se cierra.
    assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 100000}, headers=h)).status_code == 201
    g = await _gasto(cliente, h, metodo="efectivo", monto=30000)
    r = await cliente.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 70000}, headers=h)
    assert r.status_code == 200, r.text

    # Hay un turno abierto en una estación y ninguno en la web.
    estacion = (await _sql(
        "INSERT INTO platform.estaciones (gimnasio_id, nombre) VALUES (:g, 'Recepción 2') RETURNING id", g=gym.id))[0]["id"]
    turno_estacion = (await _sql(
        "INSERT INTO platform.turnos_caja (gimnasio_id, staff_id, base_inicial, estacion_id) VALUES (:g, :s, 50000, :e) RETURNING id",
        g=gym.id, s=recep["id"], e=estacion))[0]["id"]

    r = await _anular(cliente, h, g["id"])
    assert r.status_code == 400 and r.json()["error"]["codigo"] == "NO_HAY_TURNO_ABIERTO", r.text
    assert (await _sql("SELECT count(*) n FROM platform.reintegros_caja WHERE gimnasio_id = :g", g=gym.id))[0]["n"] == 0
    assert (await _sql("SELECT anulado FROM platform.gastos WHERE id = :g", g=g["id"]))[0]["anulado"] is False

    # La web no deja abrir caja mientras la estación tiene la suya; el caso real es el turno simultáneo:
    # la web abre y la estación, sin red, abre otro. Cerrada la primera, se repite el escenario en ese orden.
    await _sql("UPDATE platform.turnos_caja SET estado = 'cerrado', cerrado_en = now(), efectivo_contado = 50000, diferencia = 0 WHERE id = :t", t=turno_estacion)
    assert (await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 10000}, headers=h)).status_code == 201
    web = await _turno(cliente, h)
    simultaneo = (await _sql(
        "INSERT INTO platform.turnos_caja (gimnasio_id, staff_id, base_inicial, estacion_id) VALUES (:g, :s, 20000, :e) RETURNING id",
        g=gym.id, s=recep["id"], e=estacion))[0]["id"]
    r = await _anular(cliente, h, g["id"])
    assert r.status_code == 200, r.text
    assert r.json()["turno_reintegro_id"] == web["id"] != str(simultaneo)
    assert float((await _turno(cliente, h))["reintegros_efectivo"]) == 30000
    assert (await _sql("SELECT turno_id FROM platform.reintegros_caja WHERE gasto_id = :g", g=g["id"]))[0]["turno_id"] != simultaneo
