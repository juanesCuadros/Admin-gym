"""Escritorio: registrar un cliente desde la estación, con foto opcional (E-41). Exige conexión."""
import base64
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica
from tests.sync_util import API, estacion_activa, sql
from tests import sync_util as u

pytestmark = pytest.mark.asyncio

CLIENTES = f"{API}/sync/clientes"
# Basta con la firma de un JPG: el servidor decide el tipo por los primeros bytes.
FOTO_JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 2000


async def test_registrar_con_foto_y_sin_foto(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    datos = {"tipo_documento": "CC", "documento": "10203040", "nombre": "Pedro Gómez", "consentimiento_1581": True}
    r = await cliente.post(CLIENTES, json={"staff_id": str(jefe["id"]), "cliente": datos,
                                           "foto_base64": "data:image/jpeg;base64," + base64.b64encode(FOTO_JPG).decode()}, headers=he)
    assert r.status_code == 201, r.text
    nuevo = r.json()
    assert (nuevo["documento"], nuevo["nombre"], nuevo["activo"], nuevo["con_foto"]) == ("10203040", "Pedro Gómez", True, True)

    # La web la ve con permiso de leer deportistas; no es pública.
    foto = await cliente.get(f"{API}/deportistas/{nuevo['id']}/foto", headers=hj)
    assert foto.status_code == 200 and foto.content == FOTO_JPG and foto.headers["content-type"] == "image/jpeg"
    assert (await cliente.get(f"{API}/deportistas/{nuevo['id']}/foto")).status_code == 401
    acciones = [a["accion"] for a in await u.acciones_auditoria(gym.id)]
    assert "SUBIR_FOTO_DEPORTISTA" in acciones

    # Sin foto también.
    otro = {**datos, "documento": "10203041", "nombre": "Lucía Mesa",
            "salud": {"grupo_sanguineo": "O+", "condiciones": " Asma leve ", "contacto_emergencia_nombre": "Rosa Mesa", "contacto_emergencia_telefono": "3001234567"}}
    r = await cliente.post(CLIENTES, json={"staff_id": str(jefe["id"]), "cliente": otro}, headers=he)
    assert r.status_code == 201 and r.json()["con_foto"] is False
    assert (await cliente.get(f"{API}/deportistas/{r.json()['id']}/foto", headers=hj)).status_code == 404
    ficha = (await cliente.get(f"{API}/deportistas/{r.json()['id']}", headers=hj)).json()
    assert ficha["deportista"]["salud"] == {"grupo_sanguineo": "O+", "condiciones": "Asma leve", "contacto_emergencia_nombre": "Rosa Mesa", "contacto_emergencia_telefono": "3001234567"}

    # Documento repetido: las mismas reglas de la web.
    r = await cliente.post(CLIENTES, json={"staff_id": str(jefe["id"]), "cliente": datos}, headers=he)
    assert r.status_code == 409, r.text


async def test_foto_mala_no_deja_cliente_a_medias_y_hace_falta_permiso(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    datos = {"tipo_documento": "CC", "documento": "55667788", "nombre": "Sin Foto", "consentimiento_1581": True}
    r = await cliente.post(CLIENTES, json={"staff_id": str(jefe["id"]), "cliente": datos,
                                           "foto_base64": base64.b64encode(b"no es una imagen").decode()}, headers=he)
    assert (r.status_code, u.cod(r)) == (422, "FOTO_NO_VALIDA"), r.text
    assert await sql(gym.id, "SELECT id FROM platform.deportistas WHERE documento = '55667788'") == []

    # Una recepcionista sin permiso de crear deportistas (sin fila de permiso: se cierra).
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    await sql(gym.id, "DELETE FROM platform.permisos_rol WHERE rol = 'recepcionista' AND submodulo = 'deportistas'")
    r = await cliente.post(CLIENTES, json={"staff_id": str(recepcion["id"]), "cliente": datos}, headers=he)
    assert (r.status_code, u.cod(r)) == (403, "PERMISO_DENEGADO"), r.text

    # Sin consentimiento, igual que en la web.
    r = await cliente.post(CLIENTES, json={"staff_id": str(jefe["id"]), "cliente": {**datos, "consentimiento_1581": False}}, headers=he)
    assert r.status_code == 422


async def test_la_huella_registrada_en_la_estacion_queda_cifrada_en_el_servidor(cliente: AsyncClient, fabrica: Fabrica):
    from tests.test_e9_sync_caja import enviar, op

    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id)
    plantilla = base64.b64encode(b"SIM:pedro-indice").decode()
    h = op("huella_enrolar", jefe["id"], {"deportista_id": dep, "dedo": "indice_derecho", "formato": "simulado", "template_base64": plantilla})
    otra = op("huella_enrolar", jefe["id"], {"deportista_id": str(uuid4()), "dedo": "indice_derecho",
                                             "formato": "simulado", "template_base64": plantilla})
    res = await enviar(cliente, he, h, otra)
    assert res[0]["resultado"] == "aplicada", res
    assert (res[1]["resultado"], res[1]["codigo"]) == ("invalida", "DEPORTISTA_NO_ENCONTRADO")
    fila = (await sql(gym.id, "SELECT dedo, template_cifrado FROM platform.huellas WHERE deportista_id = :d", {"d": dep}))[0]
    assert fila["dedo"] == "indice_derecho"
    assert b"pedro" not in bytes(fila["template_cifrado"])  # cifrada, nunca en claro
    assert "ENROLAR_HUELLA" in [a["accion"] for a in await u.acciones_auditoria(gym.id)]