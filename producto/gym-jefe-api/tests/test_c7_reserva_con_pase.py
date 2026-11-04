"""Pendiente #5: reservar una clase cobrando el pase de clase en el mismo paso (GW-RF-33 CA1)."""
from datetime import timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import Fabrica, ahora_utc, login


async def _preparar(cliente: AsyncClient, fabrica: Fabrica, *, cupo: int = 10, abrir_turno: bool = True):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    if abrir_turno:
        r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=h)
        assert r.status_code == 201, r.text
    r = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Visitante Sin Plan", "consentimiento_1581": True},
        headers=h,
    )
    assert r.status_code == 201, r.text
    dep_id = r.json()["id"]
    r = await cliente.post(
        "/api/v1/clases",
        json={"nombre": "Spinning", "profesor_externo": "Profe", "cupo": cupo, "fecha_hora": (ahora_utc() + timedelta(days=1)).isoformat()},
        headers=h,
    )
    assert r.status_code == 201, r.text
    datos = r.json()
    clase_id = datos["id"] if "id" in datos else datos["items"][0]["id"]
    return gym, h, dep_id, clase_id


def _cobro(**extra):
    return {"metodo": "efectivo", "tipo_medio": "efectivo", "valor_recibido": 20000, **extra}


async def _reservar(cliente, h, clase_id, cuerpo, clave=None):
    headers = {**h}
    if clave:
        headers["X-Idempotency-Key"] = clave
    return await cliente.post(f"/api/v1/clases/{clase_id}/reservas", json=cuerpo, headers=headers)


@pytest.mark.asyncio
async def test_sin_membresia_reserva_cobrando_el_pase(cliente: AsyncClient, fabrica: Fabrica):
    _, h, dep_id, clase_id = await _preparar(cliente, fabrica)

    # Sin pase ni cobro: se sigue exigiendo el pase (CA1).
    r = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id})
    assert r.status_code == 400
    assert r.json()["error"]["codigo"] == "PASE_CLASE_REQUERIDO"

    clave = str(uuid4())
    r = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=12000)}, clave)
    assert r.status_code == 201, r.text
    reserva = r.json()
    assert reserva["pase_pagado"] is True
    assert float(reserva["total_cobrado"]) == 12000
    assert float(reserva["cambio_devuelto"]) == 8000

    # La venta quedó en el turno, ligada al deportista.
    turno = (await cliente.get("/api/v1/caja/turnos/actual", headers=h)).json()
    assert float(turno["ventas_efectivo"]) == 12000

    # Reintento con la misma clave: misma reserva, sin segundo cobro.
    r2 = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=12000)}, clave)
    assert r2.status_code == 201, r2.text
    assert r2.json()["id"] == reserva["id"]
    turno = (await cliente.get("/api/v1/caja/turnos/actual", headers=h)).json()
    assert float(turno["ventas_efectivo"]) == 12000


@pytest.mark.asyncio
async def test_usa_el_precio_configurado(cliente: AsyncClient, fabrica: Fabrica):
    _, h, dep_id, clase_id = await _preparar(cliente, fabrica)
    version = (await cliente.get("/api/v1/my-gym/info", headers=h)).json()["version"]
    await cliente.patch("/api/v1/my-gym/parametros", json={"version": version, "precio_pase_clase": 9000}, headers=h)

    r = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=1)}, str(uuid4()))
    assert r.status_code == 201, r.text
    assert float(r.json()["total_cobrado"]) == 9000


@pytest.mark.asyncio
async def test_si_la_reserva_falla_no_queda_cobro(cliente: AsyncClient, fabrica: Fabrica):
    _, h, dep_id, clase_id = await _preparar(cliente, fabrica, cupo=1)
    otro = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Otro Visitante", "consentimiento_1581": True},
        headers=h,
    )
    r = await _reservar(cliente, h, clase_id, {"deportista_id": otro.json()["id"], "cobro": _cobro(precio_unitario=10000)}, str(uuid4()))
    assert r.status_code == 201, r.text

    # Clase llena: no se reserva y tampoco se cobra.
    r = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=10000)}, str(uuid4()))
    assert r.status_code == 400
    assert r.json()["error"]["codigo"] == "CUPO_AGOTADO"
    turno = (await cliente.get("/api/v1/caja/turnos/actual", headers=h)).json()
    assert float(turno["ventas_efectivo"]) == 10000


@pytest.mark.asyncio
async def test_sin_turno_abierto_no_reserva(cliente: AsyncClient, fabrica: Fabrica):
    _, h, dep_id, clase_id = await _preparar(cliente, fabrica, abrir_turno=False)
    r = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=10000)}, str(uuid4()))
    assert r.status_code == 404
    assert r.json()["error"]["codigo"] == "NO_HAY_TURNO_ABIERTO"
    reservas = (await cliente.get(f"/api/v1/clases/{clase_id}/reservas", headers=h)).json()
    assert reservas == []


@pytest.mark.asyncio
async def test_cobrar_exige_permiso_de_caja_y_clave(cliente: AsyncClient, fabrica: Fabrica):
    gym, h, dep_id, clase_id = await _preparar(cliente, fabrica)

    r = await _reservar(cliente, h, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=10000)})
    assert r.status_code == 400
    assert r.json()["error"]["codigo"] == "IDEMPOTENCY_KEY_REQUERIDA"

    entrenador = await fabrica.crear_staff(gym, rol="entrenador")
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(text("""
            INSERT INTO platform.permisos_rol (gimnasio_id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar)
            VALUES (:g, 'entrenador', 'clases', true, true, false, false), (:g, 'entrenador', 'caja', false, false, false, false)
            ON CONFLICT (gimnasio_id, rol, submodulo) DO UPDATE
              SET puede_crear = EXCLUDED.puede_crear, puede_leer = EXCLUDED.puede_leer
        """), {"g": gym.id})
    tok = (await login(cliente, gym, entrenador)).json()["access_token"]
    h_ent = {"Authorization": f"Bearer {tok}"}
    r = await _reservar(cliente, h_ent, clase_id, {"deportista_id": dep_id, "cobro": _cobro(precio_unitario=10000)}, str(uuid4()))
    assert r.status_code == 403
    assert r.json()["error"]["codigo"] == "PERMISO_DENEGADO"


@pytest.mark.asyncio
async def test_no_mezcla_pase_previo_y_cobro(cliente: AsyncClient, fabrica: Fabrica):
    _, h, dep_id, clase_id = await _preparar(cliente, fabrica)
    r = await _reservar(
        cliente, h, clase_id,
        {"deportista_id": dep_id, "venta_item_id": str(uuid4()), "cobro": _cobro()},
        str(uuid4()),
    )
    assert r.status_code == 422
