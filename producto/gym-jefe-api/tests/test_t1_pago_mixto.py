"""#4 Pago mixto: el total se reparte entre medios, el arqueo solo cuenta el efectivo y la anulación devuelve a cada medio."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica, login


async def _jefe_con_turno(cliente: AsyncClient, fabrica: Fabrica, base: int = 10000):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": base}, headers=headers)
    assert r.status_code == 201, r.text
    return headers


async def _pase_mixto(cliente: AsyncClient, headers: dict, efectivo: int, nequi: int, precio: int = 30000, recibido=None, clave=None):
    cuerpo = {
        "metodo": "mixto",
        "tipo_medio": "mixto",
        "pagos": [
            {"metodo": "Efectivo", "tipo_medio": "efectivo", "monto": efectivo},
            {"metodo": "Nequi", "tipo_medio": "otro", "monto": nequi},
        ],
        "items": [{"tipo": "pase_clase", "descripcion": "Pase", "cantidad": 1, "precio_unitario": precio}],
    }
    if recibido is not None:
        cuerpo["valor_recibido"] = recibido
    return await cliente.post(
        "/api/v1/caja/ventas", json=cuerpo, headers={**headers, "X-Idempotency-Key": clave or str(uuid4())}
    )


async def _turno(cliente: AsyncClient, headers: dict) -> dict:
    return (await cliente.get("/api/v1/caja/turnos/actual", headers=headers)).json()


@pytest.mark.asyncio
async def test_arqueo_solo_cuenta_la_parte_en_efectivo(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    r = await _pase_mixto(cliente, headers, efectivo=20000, nequi=10000, recibido=50000)
    assert r.status_code == 201, r.text
    venta = r.json()
    assert venta["tipo_medio"] == "mixto"
    assert float(venta["cambio_devuelto"]) == 30000  # 50.000 recibidos - 20.000 en efectivo
    assert len(venta["medios"]) == 2

    t = await _turno(cliente, headers)
    assert float(t["ventas_efectivo"]) == 20000
    assert float(t["ventas_otro"]) == 10000
    assert float(t["total_esperado_efectivo"]) == 30000  # base 10.000 + efectivo 20.000


@pytest.mark.asyncio
async def test_el_reparto_debe_sumar_el_total_exacto(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    for efectivo, nequi in ((10000, 10000), (20000, 20000)):
        r = await _pase_mixto(cliente, headers, efectivo=efectivo, nequi=nequi)
        assert r.status_code == 422
        assert r.json()["error"]["codigo"] == "MEDIOS_NO_SUMAN_TOTAL"
    assert float((await _turno(cliente, headers))["ventas_efectivo"]) == 0


@pytest.mark.asyncio
async def test_recibido_menor_a_la_parte_en_efectivo_se_rechaza(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    r = await _pase_mixto(cliente, headers, efectivo=20000, nequi=10000, recibido=15000)
    assert r.status_code == 400
    assert r.json()["error"]["codigo"] == "PAGO_INSUFICIENTE"


@pytest.mark.asyncio
async def test_mixto_exige_dos_medios_y_solo_aplica_a_mixto(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    item = {"tipo": "pase_clase", "descripcion": "Pase", "cantidad": 1, "precio_unitario": 30000}
    medio = {"metodo": "Efectivo", "tipo_medio": "efectivo", "monto": 30000}
    for cuerpo in (
        {"metodo": "mixto", "tipo_medio": "mixto", "pagos": [medio], "items": [item]},
        {"metodo": "efectivo", "tipo_medio": "efectivo", "pagos": [medio, medio], "items": [item]},
    ):
        r = await cliente.post("/api/v1/caja/ventas", json=cuerpo, headers={**headers, "X-Idempotency-Key": str(uuid4())})
        assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_no_se_cobra_dos_veces_al_reintentar(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    clave = str(uuid4())
    assert (await _pase_mixto(cliente, headers, efectivo=20000, nequi=10000, clave=clave)).status_code == 201
    r = await _pase_mixto(cliente, headers, efectivo=20000, nequi=10000, clave=clave)
    assert r.status_code in (200, 201), r.text
    t = await _turno(cliente, headers)
    assert float(t["ventas_efectivo"]) == 20000
    assert float(t["ventas_otro"]) == 10000


@pytest.mark.asyncio
async def test_anular_devuelve_a_cada_medio(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    venta = (await _pase_mixto(cliente, headers, efectivo=20000, nequi=10000)).json()
    # Lo que se pida como medio de reembolso no cuenta: se devuelve por donde entró.
    r = await cliente.post(
        f"/api/v1/caja/ventas/{venta['id']}/anular",
        json={"motivo": "Prueba de anulación", "tipo_medio_reembolso": "otro"},
        headers=headers,
    )
    assert r.status_code in (200, 201), r.text
    t = await _turno(cliente, headers)
    assert float(t["ventas_efectivo"]) == 0
    assert float(t["ventas_otro"]) == 0
    # La venta anulada no suma, y la devolución en efectivo sale del turno: 10.000 - 20.000.
    assert float(t["devoluciones_efectivo"]) == 20000
    assert float(t["total_esperado_efectivo"]) == -10000


async def _cliente_con_plan(cliente: AsyncClient, headers: dict) -> tuple:
    plan = await cliente.post(
        "/api/v1/planes", json={"nombre": f"Plan {uuid4().hex[:5]}", "precio": 80000, "duracion_dias": 30, "tipo": "individual"}, headers=headers
    )
    assert plan.status_code == 201, plan.text
    dep = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Cliente", "consentimiento_1581": True},
        headers=headers,
    )
    assert dep.status_code == 201, dep.text
    return dep.json()["id"], plan.json()["id"]


@pytest.mark.asyncio
async def test_membresia_con_pago_mixto_y_su_anulacion(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    deportista_id, plan_id = await _cliente_con_plan(cliente, headers)
    r = await cliente.post(
        "/api/v1/membresias/asignar",
        json={
            "deportista_id": deportista_id,
            "plan_id": plan_id,
            "pago": {
                "monto": 80000,
                "metodo": "mixto",
                "tipo_medio": "mixto",
                "pagos": [
                    {"metodo": "Efectivo", "tipo_medio": "efectivo", "monto": 50000},
                    {"metodo": "Nequi", "tipo_medio": "otro", "monto": 30000},
                ],
            },
        },
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )
    assert r.status_code == 201, r.text
    pago_id = r.json()["pago"]["id"]
    t = await _turno(cliente, headers)
    assert float(t["pagos_membresia_efectivo"]) == 50000
    assert float(t["pagos_membresia_otro"]) == 30000
    assert float(t["total_esperado_efectivo"]) == 60000

    movs = (await cliente.get(f"/api/v1/caja/turnos/{t['id']}/movimientos", headers=headers)).json()["items"]
    assert any("Efectivo $50.000 + Nequi $30.000" in m["concepto"] for m in movs)

    r = await cliente.post(
        f"/api/v1/caja/pagos-membresia/{pago_id}/anular", json={"motivo": "Prueba de anulación"}, headers=headers
    )
    assert r.status_code in (200, 201), r.text
    t = await _turno(cliente, headers)
    assert float(t["pagos_membresia_efectivo"]) == 0
    assert float(t["devoluciones_efectivo"]) == 50000


@pytest.mark.asyncio
async def test_reporte_reparte_el_pago_entre_sus_medios(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    assert (await _pase_mixto(cliente, headers, efectivo=20000, nequi=10000)).status_code == 201
    from app.core.timezone import today_local

    hoy = today_local().isoformat()
    r = await cliente.get("/api/v1/reportes/ingresos", params={"fecha_inicio": hoy, "fecha_fin": hoy}, headers=headers)
    assert r.status_code == 200, r.text
    desglose = r.json()["desglose_por_metodo"]
    assert float(desglose["efectivo"]) == 20000
    assert float(desglose["nequi"]) == 10000
    assert "mixto" not in desglose
