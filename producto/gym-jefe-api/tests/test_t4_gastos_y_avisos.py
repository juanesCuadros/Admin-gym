"""Tanda 4: gastos, pago a entrenadores y avisos de vencimiento."""
from datetime import timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.timezone import today_local
from tests.conftest import ADMIN_URL, Fabrica, login

HOY = lambda: today_local().isoformat()


async def _sql(sentencia: str, **params):
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(text("SET session_replication_role = replica"))
        await con.execute(text(sentencia), params)
    await engine.dispose()


async def _token(cliente: AsyncClient, gym, staff) -> dict:
    tok = (await login(cliente, gym, staff)).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


async def _jefe(cliente: AsyncClient, fabrica: Fabrica, turno: bool = True):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    headers = await _token(cliente, gym, jefe)
    if turno:
        r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 100000}, headers=headers)
        assert r.status_code == 201, r.text
    return gym, jefe, headers


def _gasto(**extra) -> dict:
    return {"categoria": "Arriendo", "beneficiario_tipo": "externo", "beneficiario_nombre": "Don Pedro", "metodo": "transferencia", "monto": 50000, **extra}


async def _registrar(cliente: AsyncClient, headers: dict, clave=None, **extra):
    return await cliente.post("/api/v1/gastos", json=_gasto(**extra), headers={**headers, "X-Idempotency-Key": clave or str(uuid4())})


async def _turno(cliente: AsyncClient, headers: dict) -> dict:
    return (await cliente.get("/api/v1/caja/turnos/actual", headers=headers)).json()


@pytest.mark.asyncio
async def test_transferencia_no_toca_la_caja_y_efectivo_si(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    assert (await _registrar(cliente, headers)).status_code == 201
    assert float((await _turno(cliente, headers))["total_esperado_efectivo"]) == 100000

    r = await _registrar(cliente, headers, metodo="efectivo", monto=30000)
    assert r.status_code == 201, r.text
    assert r.json()["turno_id"]
    t = await _turno(cliente, headers)
    assert float(t["egresos_efectivo"]) == 30000
    assert float(t["total_esperado_efectivo"]) == 70000

    r = await cliente.get("/api/v1/gastos", params={"desde": HOY(), "hasta": HOY()}, headers=headers)
    assert r.json()["total"] == 2
    assert float(r.json()["suma"]) == 80000


@pytest.mark.asyncio
async def test_efectivo_exige_turno_abierto(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica, turno=False)
    r = await _registrar(cliente, headers, metodo="efectivo")
    assert r.status_code == 404
    assert r.json()["error"]["codigo"] == "NO_HAY_TURNO_ABIERTO"
    assert (await cliente.get("/api/v1/gastos", params={"desde": HOY(), "hasta": HOY()}, headers=headers)).json()["total"] == 0


@pytest.mark.asyncio
async def test_no_se_registra_dos_veces_al_reintentar(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    clave = str(uuid4())
    a = await _registrar(cliente, headers, clave=clave, metodo="efectivo", monto=10000)
    b = await _registrar(cliente, headers, clave=clave, metodo="efectivo", monto=10000)
    assert a.status_code == b.status_code == 201
    assert a.json()["id"] == b.json()["id"]
    assert float((await _turno(cliente, headers))["egresos_efectivo"]) == 10000


@pytest.mark.asyncio
async def test_beneficiario_valido(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    r = await _registrar(cliente, headers, beneficiario_nombre="")
    assert r.status_code == 422
    r = await _registrar(cliente, headers, beneficiario_tipo="staff", beneficiario_nombre=None)
    assert r.status_code == 422
    r = await _registrar(cliente, headers, beneficiario_tipo="staff", beneficiario_staff_id=str(uuid4()))
    assert r.status_code == 404
    aseo = await fabrica.crear_staff(gym, rol="recepcionista")
    r = await _registrar(cliente, headers, beneficiario_tipo="staff", beneficiario_staff_id=str(aseo["id"]), beneficiario_nombre=None)
    assert r.status_code == 201, r.text
    assert r.json()["beneficiario_nombre"] == "Staff recepcionista"


@pytest.mark.asyncio
async def test_por_defecto_solo_el_jefe_y_se_puede_habilitar(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    h_rec = await _token(cliente, gym, recepcion)
    assert (await _registrar(cliente, h_rec)).status_code == 403
    assert (await cliente.get("/api/v1/gastos", params={"desde": HOY(), "hasta": HOY()}, headers=h_rec)).status_code == 403

    await _sql(
        "INSERT INTO platform.permisos_rol (gimnasio_id, rol, submodulo, puede_crear, puede_leer) "
        "VALUES (:g, 'recepcionista', 'gastos', true, true) "
        "ON CONFLICT (gimnasio_id, rol, submodulo) DO UPDATE SET puede_crear = true, puede_leer = true",
        g=gym.id,
    )
    assert (await _registrar(cliente, h_rec)).status_code == 201


@pytest.mark.asyncio
async def test_resultado_ingresos_menos_gastos(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    r = await cliente.post(
        "/api/v1/caja/ventas",
        json={"metodo": "efectivo", "tipo_medio": "efectivo", "items": [{"tipo": "pase_clase", "descripcion": "Pase", "cantidad": 1, "precio_unitario": 200000}]},
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    await _registrar(cliente, headers, monto=50000)
    await _registrar(cliente, headers, monto=20000, categoria="Aseo")
    d = (await cliente.get("/api/v1/gastos/resultado", params={"desde": HOY(), "hasta": HOY()}, headers=headers)).json()
    assert float(d["ingresos"]) == 200000
    assert float(d["gastos"]) == 70000
    assert float(d["resultado"]) == 130000
    assert float(d["gastos_por_categoria"]["Aseo"]) == 20000


async def _entrenador(cliente: AsyncClient, fabrica: Fabrica, gym, headers: dict, config: dict) -> dict:
    e = await fabrica.crear_staff(gym, rol="entrenador")
    r = await cliente.put(f"/api/v1/gastos/entrenadores/{e['id']}/config", json=config, headers=headers)
    assert r.status_code == 200, r.text
    return e


async def _liquidacion(cliente: AsyncClient, headers: dict, staff_id) -> dict:
    filas = (await cliente.get("/api/v1/gastos/entrenadores", params={"desde": HOY(), "hasta": HOY()}, headers=headers)).json()
    return next(f for f in filas if f["staff_id"] == str(staff_id))


@pytest.mark.asyncio
async def test_sueldo_fijo_y_pago_descuenta_el_saldo(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    e = await _entrenador(cliente, fabrica, gym, headers, {"esquema": "fijo", "valor": 1000000})
    l = await _liquidacion(cliente, headers, e["id"])
    assert float(l["monto_calculado"]) == 1000000 and float(l["saldo"]) == 1000000

    r = await cliente.post(
        f"/api/v1/gastos/entrenadores/{e['id']}/pagos",
        json={"desde": HOY(), "hasta": HOY(), "monto": 400000, "metodo": "efectivo"},
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    assert float(r.json()["monto_calculado"]) == 1000000
    l = await _liquidacion(cliente, headers, e["id"])
    assert float(l["pagado"]) == 400000 and float(l["saldo"]) == 600000
    # También queda como gasto y sale de la caja.
    assert float((await _turno(cliente, headers))["egresos_efectivo"]) == 400000
    g = (await cliente.get("/api/v1/gastos", params={"desde": HOY(), "hasta": HOY(), "categoria": "Pago a entrenador"}, headers=headers)).json()
    assert g["total"] == 1


@pytest.mark.asyncio
async def test_por_clase_solo_cuenta_las_realizadas(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    e = await _entrenador(cliente, fabrica, gym, headers, {"esquema": "por_clase", "valor": 25000})
    for estado in ("realizada", "realizada", "programada", "cancelada"):
        await _sql(
            "INSERT INTO platform.clases (gimnasio_id, nombre, entrenador_id, cupo, fecha_hora, estado) "
            "VALUES (:g, 'Zumba', :e, 10, now(), :estado)",
            g=gym.id, e=e["id"], estado=estado,
        )
    l = await _liquidacion(cliente, headers, e["id"])
    assert l["clases_dictadas"] == 2
    assert float(l["monto_calculado"]) == 50000


async def _vender_membresia(cliente: AsyncClient, headers: dict, precio: int = 100000) -> str:
    plan = await cliente.post("/api/v1/planes", json={"nombre": f"P{uuid4().hex[:5]}", "precio": precio, "duracion_dias": 30, "tipo": "individual"}, headers=headers)
    assert plan.status_code == 201, plan.text
    dep = await cliente.post("/api/v1/deportistas", json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Ana", "telefono": "3001234567", "consentimiento_1581": True}, headers=headers)
    assert dep.status_code == 201, dep.text
    r = await cliente.post(
        "/api/v1/membresias/asignar",
        json={"deportista_id": dep.json()["id"], "plan_id": plan.json()["id"], "pago": {"monto": precio, "metodo": "efectivo", "tipo_medio": "efectivo"}},
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_comision_por_ventas_y_por_clientes_asignados(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers = await _jefe(cliente, fabrica)
    vendedor = await _entrenador(cliente, fabrica, gym, headers, {"esquema": "comision", "valor": 10, "base_comision": "membresias_vendidas"})
    guia = await _entrenador(cliente, fabrica, gym, headers, {"esquema": "comision", "valor": 20, "base_comision": "clientes_asignados"})

    memb = await _vender_membresia(cliente, headers)
    await _sql("UPDATE platform.pagos_membresia SET registrado_por = :e WHERE membresia_id = :m", e=vendedor["id"], m=memb)
    await _sql(
        "INSERT INTO platform.rutinas_asignadas (gimnasio_id, deportista_id, entrenador_id, nombre) "
        "SELECT gimnasio_id, deportista_id, :e, 'Rutina' FROM platform.membresias WHERE id = :m",
        e=guia["id"], m=memb,
    )
    assert float((await _liquidacion(cliente, headers, vendedor["id"]))["monto_calculado"]) == 10000
    assert float((await _liquidacion(cliente, headers, guia["id"]))["monto_calculado"]) == 20000


@pytest.mark.asyncio
async def test_pago_a_entrenadores_solo_el_jefe(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    e = await _entrenador(cliente, fabrica, gym, headers, {"esquema": "fijo", "valor": 1000})
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    h_rec = await _token(cliente, gym, recepcion)
    assert (await cliente.get("/api/v1/gastos/entrenadores", params={"desde": HOY(), "hasta": HOY()}, headers=h_rec)).status_code == 403
    r = await cliente.post(
        f"/api/v1/gastos/entrenadores/{e['id']}/pagos",
        json={"desde": HOY(), "hasta": HOY(), "monto": 1000, "metodo": "transferencia"},
        headers={**h_rec, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_config_valida_y_no_cruza_gimnasios(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await _jefe(cliente, fabrica)
    e = await fabrica.crear_staff(gym, rol="entrenador")
    url = f"/api/v1/gastos/entrenadores/{e['id']}/config"
    assert (await cliente.put(url, json={"esquema": "comision", "valor": 10}, headers=headers)).status_code == 422
    assert (await cliente.put(url, json={"esquema": "comision", "valor": 101, "base_comision": "membresias_vendidas"}, headers=headers)).status_code == 422
    assert (await cliente.put(url, json={"esquema": "fijo", "valor": 10, "base_comision": "membresias_vendidas"}, headers=headers)).status_code == 422
    _, _, otro = await _jefe(cliente, fabrica)
    assert (await cliente.put(url, json={"esquema": "fijo", "valor": 10}, headers=otro)).status_code == 404


async def _vencimiento(membresia_id: str, dias: int):
    await _sql(
        "UPDATE platform.membresias SET fecha_inicio = current_date - 60, fecha_vencimiento = :f WHERE id = :m",
        f=today_local() + timedelta(days=dias), m=membresia_id,
    )


@pytest.mark.asyncio
async def test_lista_de_avisos_y_marca_quien_aviso(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    por_vencer = await _vender_membresia(cliente, headers)
    en_gracia = await _vender_membresia(cliente, headers)
    lejos = await _vender_membresia(cliente, headers)
    muy_vencida = await _vender_membresia(cliente, headers)
    await _vencimiento(por_vencer, 3)
    await _vencimiento(en_gracia, -2)
    await _vencimiento(lejos, 20)
    await _vencimiento(muy_vencida, -40)

    r = await cliente.get("/api/v1/membresias/avisos-vencimiento", headers=headers)
    assert r.status_code == 200, r.text
    items = {i["membresia_id"]: i for i in r.json()["items"]}
    assert set(items) == {por_vencer, en_gracia}
    assert items[por_vencer]["situacion"] == "por_vencer" and items[por_vencer]["dias"] == 3
    assert items[en_gracia]["situacion"] == "en_gracia" and items[en_gracia]["dias"] == -2
    assert items[por_vencer]["ultimo_aviso_en"] is None

    r = await cliente.post(f"/api/v1/membresias/{por_vencer}/aviso", headers=headers)
    assert r.status_code == 204, r.text
    items = {i["membresia_id"]: i for i in (await cliente.get("/api/v1/membresias/avisos-vencimiento", headers=headers)).json()["items"]}
    assert items[por_vencer]["ultimo_aviso_en"]
    assert items[por_vencer]["ultimo_aviso_por"]

    # Si cambia el vencimiento, es un ciclo nuevo: vuelve a salir sin avisar.
    await _vencimiento(por_vencer, 4)
    items = {i["membresia_id"]: i for i in (await cliente.get("/api/v1/membresias/avisos-vencimiento", headers=headers)).json()["items"]}
    assert items[por_vencer]["ultimo_aviso_en"] is None


@pytest.mark.asyncio
async def test_quien_ya_renovo_o_esta_congelado_no_sale(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    congelada = await _vender_membresia(cliente, headers)
    r = await cliente.post(f"/api/v1/membresias/{congelada}/congelar", json={"motivo": "Viaje"}, headers=headers)
    assert r.status_code == 201, r.text
    await _vencimiento(congelada, 2)
    vieja = await _vender_membresia(cliente, headers)
    await _vencimiento(vieja, 2)
    await _sql(
        "INSERT INTO platform.membresias (gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento) "
        "SELECT gimnasio_id, deportista_id, plan_id, current_date, current_date + 30 FROM platform.membresias WHERE id = :m",
        m=vieja,
    )
    assert (await cliente.get("/api/v1/membresias/avisos-vencimiento", headers=headers)).json()["items"] == []


@pytest.mark.asyncio
async def test_aviso_no_cruza_gimnasios(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await _jefe(cliente, fabrica)
    m = await _vender_membresia(cliente, headers)
    _, _, otro = await _jefe(cliente, fabrica)
    assert (await cliente.post(f"/api/v1/membresias/{m}/aviso", headers=otro)).status_code == 404
