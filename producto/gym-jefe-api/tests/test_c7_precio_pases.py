"""Pendiente #6: el precio del pase de día y del pase de clase es un parámetro del gimnasio."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica, login


async def _jefe_con_turno(cliente: AsyncClient, fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}
    r = await cliente.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)
    assert r.status_code == 201, r.text
    return headers


async def _fijar_precios(cliente: AsyncClient, headers: dict, **precios):
    version = (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()["version"]
    return await cliente.patch("/api/v1/my-gym/parametros", json={"version": version, **precios}, headers=headers)


async def _vender_pase(cliente: AsyncClient, headers: dict, tipo: str, precio_unitario=None):
    item = {"tipo": tipo, "descripcion": "Pase", "cantidad": 1}
    if precio_unitario is not None:
        item["precio_unitario"] = precio_unitario
    return await cliente.post(
        "/api/v1/caja/ventas",
        json={"metodo": "efectivo", "tipo_medio": "efectivo", "valor_recibido": 100000, "items": [item]},
        headers={**headers, "X-Idempotency-Key": str(uuid4())},
    )


@pytest.mark.asyncio
async def test_sin_configurar_se_escribe_a_mano(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    precios = (await cliente.get("/api/v1/caja/precios-pases", headers=headers)).json()
    assert precios == {"pase_dia": None, "pase_clase": None}

    assert (await _vender_pase(cliente, headers, "pase_dia")).status_code == 400
    r = await _vender_pase(cliente, headers, "pase_dia", precio_unitario=12000)
    assert r.status_code == 201, r.text
    assert float(r.json()["total"]) == 12000


@pytest.mark.asyncio
async def test_configurado_es_el_precio_de_lista(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    r = await _fijar_precios(cliente, headers, precio_pase_dia=15000, precio_pase_clase=10000)
    assert r.status_code == 200, r.text
    assert r.json()["precio_pase_dia"] == 15000

    assert (await cliente.get("/api/v1/caja/precios-pases", headers=headers)).json() == {
        "pase_dia": 15000,
        "pase_clase": 10000,
    }
    info = (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()
    assert info["precio_pase_clase"] == 10000

    # El precio que mande el cliente no cuenta: manda el configurado.
    r = await _vender_pase(cliente, headers, "pase_dia", precio_unitario=1)
    assert r.status_code == 201, r.text
    assert float(r.json()["total"]) == 15000
    r = await _vender_pase(cliente, headers, "pase_clase")
    assert r.status_code == 201, r.text
    assert float(r.json()["total"]) == 10000


@pytest.mark.asyncio
async def test_null_lo_deja_sin_configurar_y_omitir_no_lo_cambia(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe_con_turno(cliente, fabrica)
    await _fijar_precios(cliente, headers, precio_pase_dia=15000, precio_pase_clase=10000)

    r = await _fijar_precios(cliente, headers, dias_gracia_mora=2)
    assert r.json()["precio_pase_dia"] == 15000

    r = await _fijar_precios(cliente, headers, precio_pase_dia=None)
    assert r.json()["precio_pase_dia"] is None
    assert r.json()["precio_pase_clase"] == 10000

    assert (await _fijar_precios(cliente, headers, precio_pase_clase=-1)).status_code == 422
