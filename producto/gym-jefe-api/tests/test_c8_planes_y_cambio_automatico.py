"""
Borrado de planes y cambio automático de plan (commits del 2-nov).

- Un plan solo se borra si nadie lo ha usado, y el borrado queda auditado.
- Asignar un plan distinto a quien ya tiene membresía cambia el plan: cobra una sola vez y no pierde días.
- Tras cambiar de plan o entrar a un plan grupal, el cliente conserva el acceso que ya había pagado.
"""
from datetime import date, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import Fabrica, login

EFECTIVO = {"metodo": "efectivo", "tipo_medio": "efectivo"}


async def _preparar(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    headers = {"Authorization": f"Bearer {(await login(cliente, gym, jefe)).json()['access_token']}"}
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)
    assert r.status_code == 201, r.text
    return gym, headers


async def _plan(cliente, headers, nombre, precio=80000, dias=30, tipo="individual", cupo=1) -> str:
    r = await cliente.post(
        "/api/v1/planes",
        json={"nombre": nombre, "precio": precio, "duracion_dias": dias, "tipo": tipo, "cupo_personas": cupo},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _deportista(cliente, headers, nombre="Cliente Prueba") -> str:
    r = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "CC",
            "documento": uuid4().hex[:10],
            "nombre": nombre,
            "fecha_nacimiento": "1990-01-15",
            "consentimiento_1581": True,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _clave(headers: dict, clave: str = "") -> dict:
    return {**headers, "X-Idempotency-Key": clave or f"clave-{uuid4().hex}"}


async def _asignar(cliente, headers, dep_id, plan_id, monto=80000, clave=""):
    return await cliente.post(
        "/api/v1/membresias/asignar",
        json={"deportista_id": dep_id, "plan_id": plan_id, "pago": {"monto": monto, **EFECTIVO}},
        headers=_clave(headers, clave),
    )


async def _valor(fabrica: Fabrica, sql: str, **params):
    async with fabrica.admin_engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar_one()


async def _activas(fabrica: Fabrica, gym, dep_id) -> list:
    async with fabrica.admin_engine.connect() as conn:
        res = await conn.execute(
            text("""
                SELECT plan_id::text AS plan_id, fecha_inicio, fecha_vencimiento
                FROM platform.membresias
                WHERE gimnasio_id = :g AND deportista_id = :d AND cancelada = false
            """),
            {"g": gym.id, "d": dep_id},
        )
        return [dict(r) for r in res.mappings().all()]


async def _cobros(fabrica: Fabrica, gym) -> int:
    return await _valor(fabrica, "SELECT count(*) FROM platform.pagos_membresia WHERE gimnasio_id = :g", g=gym.id)


async def _entrar(cliente, headers, dep_id) -> dict:
    r = await cliente.post("/api/v1/control-ingreso/checkin-manual", json={"deportista_id": dep_id}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------- borrado de planes


@pytest.mark.asyncio
async def test_borrar_plan_sin_uso_lo_elimina_y_audita(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _preparar(cliente, fabrica)
    plan_id = await _plan(cliente, headers, "Sin uso")

    r = await cliente.delete(f"/api/v1/planes/{plan_id}", headers=headers)
    assert r.status_code == 200, r.text

    assert await _valor(fabrica, "SELECT count(*) FROM platform.planes WHERE id = :p", p=plan_id) == 0
    assert (
        await _valor(
            fabrica,
            "SELECT count(*) FROM platform.auditoria_gym WHERE gimnasio_id = :g AND accion = 'ELIMINAR_PLAN'",
            g=gym.id,
        )
        == 1
    )


@pytest.mark.asyncio
async def test_no_se_borra_un_plan_con_membresias(cliente: AsyncClient, fabrica: Fabrica):
    _, headers = await _preparar(cliente, fabrica)
    plan_id = await _plan(cliente, headers, "Vendido")
    dep_id = await _deportista(cliente, headers)
    assert (await _asignar(cliente, headers, dep_id, plan_id)).status_code == 201

    r = await cliente.delete(f"/api/v1/planes/{plan_id}", headers=headers)
    assert r.status_code == 409, r.text
    assert await _valor(fabrica, "SELECT count(*) FROM platform.planes WHERE id = :p", p=plan_id) == 1


@pytest.mark.asyncio
async def test_no_se_borra_el_plan_de_otro_gimnasio(cliente: AsyncClient, fabrica: Fabrica):
    _, headers_a = await _preparar(cliente, fabrica)
    _, headers_b = await _preparar(cliente, fabrica)
    plan_b = await _plan(cliente, headers_b, "De otro gimnasio")

    r = await cliente.delete(f"/api/v1/planes/{plan_b}", headers=headers_a)
    assert r.status_code == 404, r.text
    assert await _valor(fabrica, "SELECT count(*) FROM platform.planes WHERE id = :p", p=plan_b) == 1


# --------------------------------------------------------------------- cambio automático


@pytest.mark.asyncio
async def test_asignar_plan_distinto_cambia_sin_perder_dias_y_cobra_una_vez(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    trimestral = await _plan(cliente, headers, "Trimestral", precio=210000, dias=90)
    dep_id = await _deportista(cliente, headers)

    r1 = await _asignar(cliente, headers, dep_id, mensual)
    assert r1.status_code == 201, r1.text
    fin_mensual = date.fromisoformat(r1.json()["fecha_vencimiento"])

    r2 = await _asignar(cliente, headers, dep_id, trimestral, monto=210000)
    assert r2.status_code in (200, 201), r2.text

    activas = await _activas(fabrica, gym, dep_id)
    assert len(activas) == 1, activas
    assert activas[0]["plan_id"] == trimestral
    assert activas[0]["fecha_vencimiento"] >= fin_mensual + timedelta(days=90), activas
    assert await _cobros(fabrica, gym) == 2


@pytest.mark.asyncio
async def test_reintentar_el_cambio_automatico_no_cobra_dos_veces(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    trimestral = await _plan(cliente, headers, "Trimestral", precio=210000, dias=90)
    dep_id = await _deportista(cliente, headers)
    assert (await _asignar(cliente, headers, dep_id, mensual)).status_code == 201

    clave = f"clave-{uuid4().hex}"
    primero = await _asignar(cliente, headers, dep_id, trimestral, monto=210000, clave=clave)
    assert primero.status_code in (200, 201), primero.text
    segundo = await _asignar(cliente, headers, dep_id, trimestral, monto=210000, clave=clave)
    assert segundo.status_code in (200, 201), segundo.text

    assert segundo.json()["id"] == primero.json()["id"]
    assert await _cobros(fabrica, gym) == 2
    assert len(await _activas(fabrica, gym, dep_id)) == 1


@pytest.mark.asyncio
async def test_asignar_el_mismo_plan_se_rechaza(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    dep_id = await _deportista(cliente, headers)
    assert (await _asignar(cliente, headers, dep_id, mensual)).status_code == 201

    r = await _asignar(cliente, headers, dep_id, mensual)
    assert r.status_code == 409, r.text
    assert await _cobros(fabrica, gym) == 1


@pytest.mark.asyncio
async def test_membresia_congelada_no_cambia_de_plan_ni_cobra(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    trimestral = await _plan(cliente, headers, "Trimestral", precio=210000, dias=90)
    dep_id = await _deportista(cliente, headers)
    memb_id = (await _asignar(cliente, headers, dep_id, mensual)).json()["id"]
    assert (await cliente.post(f"/api/v1/membresias/{memb_id}/congelar", json={}, headers=headers)).status_code == 201

    r = await _asignar(cliente, headers, dep_id, trimestral, monto=210000)
    assert r.status_code == 409, r.text

    activas = await _activas(fabrica, gym, dep_id)
    assert [a["plan_id"] for a in activas] == [mensual]
    assert await _cobros(fabrica, gym) == 1


@pytest.mark.asyncio
async def test_tras_el_cambio_automatico_el_cliente_sigue_entrando(cliente: AsyncClient, fabrica: Fabrica):
    """Ya pagó hasta el fin del plan anterior: cambiar de plan no le puede quitar el acceso de hoy."""
    _, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    trimestral = await _plan(cliente, headers, "Trimestral", precio=210000, dias=90)
    dep_id = await _deportista(cliente, headers)
    assert (await _asignar(cliente, headers, dep_id, mensual)).status_code == 201
    assert (await _asignar(cliente, headers, dep_id, trimestral, monto=210000)).status_code in (200, 201)

    entrada = await _entrar(cliente, headers, dep_id)
    assert entrada["resultado"] == "abrio", entrada


# --------------------------------------------------------------------- plan grupal


async def _paquete(cliente, headers, plan_id, titular, beneficiario, monto=120000):
    return await cliente.post(
        "/api/v1/membresias/paquetes",
        json={
            "plan_id": plan_id,
            "titular_id": titular,
            "beneficiarios": [titular, beneficiario],
            "pago": {"monto": monto, **EFECTIVO},
        },
        headers=_clave(headers),
    )


@pytest.mark.asyncio
async def test_beneficiario_con_plan_vigente_queda_con_uno_solo_y_sin_perder_dias(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    pareja = await _plan(cliente, headers, "Pareja", precio=120000, dias=30, tipo="pareja", cupo=2)
    titular = await _deportista(cliente, headers, "Titular")
    beneficiario = await _deportista(cliente, headers, "Beneficiario")

    r1 = await _asignar(cliente, headers, beneficiario, mensual)
    assert r1.status_code == 201, r1.text
    fin_mensual = date.fromisoformat(r1.json()["fecha_vencimiento"])

    r2 = await _paquete(cliente, headers, pareja, titular, beneficiario)
    assert r2.status_code == 201, r2.text

    activas = await _activas(fabrica, gym, beneficiario)
    assert len(activas) == 1, activas
    assert activas[0]["plan_id"] == pareja
    assert activas[0]["fecha_inicio"] > fin_mensual, activas


@pytest.mark.asyncio
async def test_beneficiario_con_plan_vigente_sigue_entrando_hoy(cliente: AsyncClient, fabrica: Fabrica):
    """Ya pagó hasta el fin de su plan: entrar a un plan grupal no le puede quitar el acceso de hoy."""
    _, headers = await _preparar(cliente, fabrica)
    mensual = await _plan(cliente, headers, "Mensual")
    pareja = await _plan(cliente, headers, "Pareja", precio=120000, dias=30, tipo="pareja", cupo=2)
    titular = await _deportista(cliente, headers, "Titular")
    beneficiario = await _deportista(cliente, headers, "Beneficiario")
    assert (await _asignar(cliente, headers, beneficiario, mensual)).status_code == 201
    assert (await _paquete(cliente, headers, pareja, titular, beneficiario)).status_code == 201

    entrada = await _entrar(cliente, headers, beneficiario)
    assert entrada["resultado"] == "abrio", entrada
