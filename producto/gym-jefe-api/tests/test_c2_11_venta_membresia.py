"""
Venta de membresía en un solo paso (GW-RF-25, decisión del 15-oct, migración 021).

- Vender un plan crea la membresía y su cobro en la misma transacción: da la duración del plan, no el doble.
- Las renovaciones guardan los días que suman, así el recálculo tras una anulación no le quita días a nadie.
- El cambio de plan empieza cuando termina el actual (CA3) y se cobra en el mismo paso.
"""
from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.timezone import today_local
from tests.conftest import Fabrica, login

EFECTIVO = {"metodo": "efectivo", "tipo_medio": "efectivo"}


async def _preparar(cliente: AsyncClient, fabrica: Fabrica, abrir_turno: bool = True):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    headers = {"Authorization": f"Bearer {(await login(cliente, gym, jefe)).json()['access_token']}"}

    planes = {}
    for nombre, precio, dias in (("Mensual", 80000, 30), ("Trimestral", 210000, 90)):
        r = await cliente.post(
            "/api/v1/planes",
            json={"nombre": nombre, "precio": precio, "duracion_dias": dias, "tipo": "individual"},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        planes[nombre] = r.json()["id"]

    r_dep = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Cliente Venta", "consentimiento_1581": True},
        headers=headers,
    )
    assert r_dep.status_code == 201, r_dep.text

    if abrir_turno:
        r_t = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)
        assert r_t.status_code == 201, r_t.text
    return gym, headers, planes, r_dep.json()["id"]


def _clave(headers: dict, clave: str = "") -> dict:
    return {**headers, "X-Idempotency-Key": clave or f"clave-{uuid4().hex}"}


async def _vender(cliente, headers, dep_id, plan_id, monto, clave=""):
    return await cliente.post(
        "/api/v1/membresias/asignar",
        json={"deportista_id": dep_id, "plan_id": plan_id, "pago": {"monto": monto, **EFECTIVO}},
        headers=_clave(headers, clave),
    )


async def _renovar(cliente, headers, membresia_id, monto=80000):
    return await cliente.post(
        "/api/v1/caja/pagos-membresia",
        json={"membresia_id": membresia_id, "monto": monto, **EFECTIVO},
        headers=_clave(headers),
    )


async def _vencimiento(cliente, headers, membresia_id) -> date:
    r = await cliente.get(f"/api/v1/membresias/{membresia_id}", headers=headers)
    assert r.status_code == 200, r.text
    return date.fromisoformat(r.json()["membresia"]["fecha_vencimiento"])


async def _contar(fabrica: Fabrica, gym, sql: str) -> int:
    async with fabrica.admin_engine.connect() as conn:
        return (await conn.execute(text(sql), {"g": gym.id})).scalar_one()


@pytest.mark.asyncio
async def test_vender_da_la_duracion_del_plan_y_registra_el_cobro(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    hoy = today_local()

    r = await _vender(cliente, headers, dep_id, planes["Mensual"], 80000)
    assert r.status_code == 201, r.text
    body = r.json()
    assert date.fromisoformat(body["fecha_vencimiento"]) == hoy + timedelta(days=30)
    assert body["pago"]["membresia_id"] == body["id"]
    assert float(body["pago"]["monto"]) == 80000
    assert date.fromisoformat(body["pago"]["nueva_fecha_vencimiento"]) == hoy + timedelta(days=30)

    # El cobro es un ingreso real del día
    ingresos = await cliente.get(f"/api/v1/reportes/ingresos?fecha_inicio={hoy}&fecha_fin={hoy}", headers=headers)
    assert float(ingresos.json()["total_ingresos_bruto"]) == 80000
    assert await _contar(
        fabrica, gym, "SELECT count(*) FROM platform.pagos_membresia WHERE gimnasio_id = :g AND es_venta"
    ) == 1


@pytest.mark.asyncio
async def test_sin_turno_no_se_vende_ni_queda_membresia(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica, abrir_turno=False)
    r = await _vender(cliente, headers, dep_id, planes["Mensual"], 80000)
    assert r.status_code == 404, r.text
    assert r.json()["error"]["codigo"] == "NO_HAY_TURNO_ABIERTO"
    assert await _contar(fabrica, gym, "SELECT count(*) FROM platform.membresias WHERE gimnasio_id = :g") == 0


@pytest.mark.asyncio
async def test_descuento_sin_motivo_no_deja_membresia(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("UPDATE platform.tenant SET permitir_descuentos = true, tope_descuento_pct = 50 WHERE id = :g"),
            {"g": gym.id},
        )
    r = await cliente.post(
        "/api/v1/membresias/asignar",
        json={"deportista_id": dep_id, "plan_id": planes["Mensual"],
              "pago": {"monto": 70000, "precio_cobrado": 70000, **EFECTIVO}},
        headers=_clave(headers),
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["codigo"] == "MOTIVO_DESCUENTO_REQUERIDO"
    assert await _contar(fabrica, gym, "SELECT count(*) FROM platform.membresias WHERE gimnasio_id = :g") == 0


@pytest.mark.asyncio
async def test_reintento_con_la_misma_clave_no_cobra_dos_veces(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    clave = f"venta-{uuid4().hex}"
    r1 = await _vender(cliente, headers, dep_id, planes["Mensual"], 80000, clave)
    r2 = await _vender(cliente, headers, dep_id, planes["Mensual"], 80000, clave)
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    assert r2.json()["id"] == r1.json()["id"]
    assert r2.json()["pago"]["id"] == r1.json()["pago"]["id"]
    assert await _contar(fabrica, gym, "SELECT count(*) FROM platform.membresias WHERE gimnasio_id = :g") == 1
    assert await _contar(fabrica, gym, "SELECT count(*) FROM platform.pagos_membresia WHERE gimnasio_id = :g") == 1


@pytest.mark.asyncio
async def test_anular_una_renovacion_no_quita_dias_de_otra(cliente: AsyncClient, fabrica: Fabrica):
    """Antes, una renovación sin días explícitos guardaba 0 y el recálculo tras una anulación la perdía."""
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    hoy = today_local()
    memb_id = (await _vender(cliente, headers, dep_id, planes["Mensual"], 80000)).json()["id"]

    r1 = await _renovar(cliente, headers, memb_id)
    assert r1.status_code == 201, r1.text
    assert r1.json()["dias_agregados"] == 30
    r2 = await _renovar(cliente, headers, memb_id)
    assert r2.status_code == 201, r2.text
    assert await _vencimiento(cliente, headers, memb_id) == hoy + timedelta(days=90)

    r_anular = await cliente.post(
        f"/api/v1/caja/pagos-membresia/{r2.json()['id']}/anular", json={"motivo": "Cobro repetido"}, headers=headers
    )
    assert r_anular.status_code == 200, r_anular.text
    assert await _vencimiento(cliente, headers, memb_id) == hoy + timedelta(days=60)


@pytest.mark.asyncio
async def test_cambio_de_plan_conserva_los_dias_y_se_cobra(cliente: AsyncClient, fabrica: Fabrica):
    """GW-RF-25 CA3: el plan nuevo empieza cuando termina el actual."""
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    hoy = today_local()
    actual = (await _vender(cliente, headers, dep_id, planes["Mensual"], 80000)).json()
    venc_actual = date.fromisoformat(actual["fecha_vencimiento"])

    r = await cliente.post(
        f"/api/v1/membresias/{actual['id']}/cambiar-plan",
        json={"nuevo_plan_id": planes["Trimestral"], "pago": {"monto": 210000, **EFECTIVO}},
        headers=_clave(headers),
    )
    assert r.status_code == 200, r.text
    nueva = r.json()
    assert date.fromisoformat(nueva["fecha_inicio"]) == venc_actual
    assert date.fromisoformat(nueva["fecha_vencimiento"]) == hoy + timedelta(days=30 + 90)
    assert nueva["pago"]["membresia_id"] == nueva["id"]
    assert float(nueva["pago"]["monto"]) == 210000

    # Renovar la membresía nueva parte de su vencimiento (y el recálculo la respeta)
    assert (await _renovar(cliente, headers, nueva["id"], 210000)).status_code == 201
    assert await _vencimiento(cliente, headers, nueva["id"]) == hoy + timedelta(days=30 + 90 + 90)


@pytest.mark.asyncio
async def test_cambio_de_plan_vencido_sin_ingreso_en_gracia_cuenta_desde_hoy(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    hoy = today_local()
    actual = (await _vender(cliente, headers, dep_id, planes["Mensual"], 80000)).json()
    # La membresía venció hace 10 días y el cliente no entró en la gracia
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("""
                UPDATE platform.membresias
                SET fecha_inicio = :ini, fecha_vencimiento = :venc WHERE id = :id
            """),
            {"ini": hoy - timedelta(days=40), "venc": hoy - timedelta(days=10), "id": actual["id"]},
        )

    r = await cliente.post(
        f"/api/v1/membresias/{actual['id']}/cambiar-plan",
        json={"nuevo_plan_id": planes["Trimestral"], "pago": {"monto": 210000, **EFECTIVO}},
        headers=_clave(headers),
    )
    assert r.status_code == 200, r.text
    assert date.fromisoformat(r.json()["fecha_inicio"]) == hoy
    assert date.fromisoformat(r.json()["fecha_vencimiento"]) == hoy + timedelta(days=90)


@pytest.mark.asyncio
async def test_descongelar_hoy_permite_entrar_hoy(cliente: AsyncClient, fabrica: Fabrica):
    """GW-RF-26 CA5: al descongelar, el cliente vuelve a entrar ese mismo día."""
    gym, headers, planes, dep_id = await _preparar(cliente, fabrica)
    memb_id = (await _vender(cliente, headers, dep_id, planes["Mensual"], 80000)).json()["id"]

    assert (await cliente.post(f"/api/v1/membresias/{memb_id}/congelar", json={}, headers=headers)).status_code == 201
    congelado = await cliente.post("/api/v1/control-ingreso/checkin-manual", json={"deportista_id": dep_id}, headers=headers)
    assert congelado.json()["resultado"] == "negado", congelado.text
    # Saca el primer intento de la ventana anti-relectura de 3 segundos
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("UPDATE platform.checkins SET ts_utc = ts_utc - interval '1 minute' WHERE gimnasio_id = :g"),
            {"g": gym.id},
        )

    assert (await cliente.post(f"/api/v1/membresias/{memb_id}/descongelar", headers=headers)).status_code == 200
    r = await cliente.post("/api/v1/control-ingreso/checkin-manual", json={"deportista_id": dep_id}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["resultado"] == "abrio", r.text
    assert r.json()["deportista"]["estado"] == "activo"
