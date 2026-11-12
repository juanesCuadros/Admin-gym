"""Escritorio · estaciones: el Jefe las crea, les regenera el código y las revoca."""
import re
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.core.security import hash_token
from app.modules.sync.estaciones import normalizar_codigo
from tests.conftest import Fabrica
from tests.sync_util import API, acciones_auditoria, cabeceras, crear_estacion, gimnasio_con_jefe, sql

pytestmark = pytest.mark.asyncio


async def test_crear_estacion_muestra_el_codigo_una_sola_vez_y_guarda_solo_su_hash(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    creada = await crear_estacion(cliente, headers, "Recepción principal")

    assert re.fullmatch(r"[A-Z2-9]{4}-[A-Z2-9]{4}", creada["codigo"])
    assert creada["estado"] == "por_activar"
    assert creada["codigo_expira_en"] is not None

    listado = (await cliente.get(f"{API}/estaciones", headers=headers)).json()
    assert [e["nombre"] for e in listado] == ["Recepción principal"]
    assert "codigo" not in listado[0]

    fila = (await sql(gym.id, "SELECT codigo_hash FROM platform.estaciones"))[0]
    assert fila["codigo_hash"] == hash_token(normalizar_codigo(creada["codigo"]))
    assert creada["codigo"] not in str(await acciones_auditoria(gym.id))


async def test_crear_estacion_queda_en_auditoria(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    await crear_estacion(cliente, headers, "Caja 1")
    registros = [a for a in await acciones_auditoria(gym.id) if a["accion"] == "CREAR_ESTACION"]
    assert len(registros) == 1 and registros[0]["detalle"]["nombre"] == "Caja 1"


async def test_no_se_repite_el_nombre_entre_estaciones_vigentes(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    primera = await crear_estacion(cliente, headers, "Recepción")
    r = await cliente.post(f"{API}/estaciones", json={"nombre": "  recepción "}, headers=headers)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "ESTACION_NOMBRE_DUPLICADO"

    # Revocada la primera, el nombre queda libre.
    r = await cliente.post(f"{API}/estaciones/{primera['id']}/revocar", json={"motivo": "Equipo dañado"}, headers=headers)
    assert r.status_code == 200, r.text
    assert (await cliente.post(f"{API}/estaciones", json={"nombre": "Recepción"}, headers=headers)).status_code == 201


async def test_solo_el_jefe_administra_estaciones(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers_jefe = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers_jefe)
    recepcion = await cabeceras(cliente, gym, await fabrica.crear_staff(gym, rol="recepcionista"))

    assert (await cliente.get(f"{API}/estaciones", headers=recepcion)).status_code == 403
    assert (await cliente.post(f"{API}/estaciones", json={"nombre": "Otra"}, headers=recepcion)).status_code == 403
    r = await cliente.post(f"{API}/estaciones/{estacion['id']}/revocar", json={"motivo": "No me toca"}, headers=recepcion)
    assert r.status_code == 403
    assert (await cliente.get(f"{API}/estaciones")).status_code in (401, 403)


async def test_la_estacion_de_otro_gimnasio_responde_404(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers_a = await gimnasio_con_jefe(cliente, fabrica)
    _, _, headers_b = await gimnasio_con_jefe(cliente, fabrica)
    estacion_a = await crear_estacion(cliente, headers_a)

    assert (await cliente.get(f"{API}/estaciones", headers=headers_b)).json() == []
    r = await cliente.post(f"{API}/estaciones/{estacion_a['id']}/revocar", json={"motivo": "Ajena"}, headers=headers_b)
    assert r.status_code == 404 and r.json()["error"]["codigo"] == "ESTACION_NO_ENCONTRADA"
    r = await cliente.post(f"{API}/estaciones/{estacion_a['id']}/codigo", headers=headers_b)
    assert r.status_code == 404
    r = await cliente.post(f"{API}/estaciones/{uuid4()}/revocar", json={"motivo": "No existe"}, headers=headers_a)
    assert r.status_code == 404


async def test_regenerar_el_codigo_invalida_el_anterior(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers)
    r = await cliente.post(f"{API}/estaciones/{estacion['id']}/codigo", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["codigo"] != estacion["codigo"]
    fila = (await sql(gym.id, "SELECT codigo_hash FROM platform.estaciones"))[0]
    assert fila["codigo_hash"] == hash_token(normalizar_codigo(r.json()["codigo"]))


async def test_revocar_exige_motivo_borra_el_codigo_y_no_se_repite(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers)
    url = f"{API}/estaciones/{estacion['id']}/revocar"

    assert (await cliente.post(url, json={"motivo": ""}, headers=headers)).status_code == 422
    r = await cliente.post(url, json={"motivo": "Se vendió el computador"}, headers=headers)
    assert r.status_code == 200 and r.json()["estado"] == "revocada"
    assert r.json()["motivo_revocacion"] == "Se vendió el computador"

    fila = (await sql(gym.id, "SELECT codigo_hash, codigo_expira_en FROM platform.estaciones"))[0]
    assert fila == {"codigo_hash": None, "codigo_expira_en": None}

    r = await cliente.post(url, json={"motivo": "Otra vez"}, headers=headers)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "ESTACION_YA_REVOCADA"
    r = await cliente.post(f"{API}/estaciones/{estacion['id']}/codigo", headers=headers)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "ESTACION_YA_REVOCADA"
    assert "REVOCAR_ESTACION" in [a["accion"] for a in await acciones_auditoria(gym.id)]


async def test_un_codigo_vencido_se_muestra_como_vencido(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    await crear_estacion(cliente, headers)
    await sql(gym.id, "UPDATE platform.estaciones SET codigo_expira_en = now() - interval '1 minute'")
    listado = (await cliente.get(f"{API}/estaciones", headers=headers)).json()
    assert listado[0]["estado"] == "codigo_vencido" and listado[0]["codigo_expira_en"] is None
