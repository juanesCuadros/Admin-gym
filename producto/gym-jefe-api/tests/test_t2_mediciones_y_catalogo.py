"""#7 mediciones sin datos supuestos y lista por deportista; #9 catálogo de clases."""
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica, login


async def _jefe(cliente: AsyncClient, fabrica: Fabrica) -> dict:
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


async def _deportista(cliente: AsyncClient, headers: dict, **extra) -> dict:
    r = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": uuid4().hex[:10], "nombre": "Ana Prueba", "consentimiento_1581": True, **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_sin_sexo_o_estatura_no_se_registra_la_medicion(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe(cliente, fabrica)
    d = await _deportista(cliente, headers)
    url = f"/api/v1/deportistas/{d['id']}/mediciones"

    for cuerpo in ({"peso": 70}, {"peso": 70, "sexo": "F"}, {"peso": 70, "altura_cm": 165}):
        r = await cliente.post(url, json=cuerpo, headers=headers)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["codigo"] == "SEXO_Y_ESTATURA_REQUERIDOS"

    r = await cliente.post(url, json={"peso": 70, "cintura": 80, "sexo": "F", "altura_cm": 165}, headers=headers)
    assert r.status_code == 201, r.text
    assert r.json()["grasa_pct"] is not None

    # Quedan en la ficha: la siguiente medición no los vuelve a pedir.
    r = await cliente.post(url, json={"peso": 69}, headers=headers)
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_sexo_otro_no_inventa_grasa_ni_musculo(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe(cliente, fabrica)
    d = await _deportista(cliente, headers)
    r = await cliente.post(
        f"/api/v1/deportistas/{d['id']}/mediciones",
        json={"peso": 70, "cintura": 80, "sexo": "otro", "altura_cm": 170},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["grasa_pct"] is None
    assert r.json()["masa_muscular"] is None
    assert float(r.json()["peso"]) == 70


@pytest.mark.asyncio
async def test_lista_con_ultima_medicion_y_busqueda(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe(cliente, fabrica)
    con = await _deportista(cliente, headers, nombre="Con Medida", sexo="M", altura_cm=175)
    await _deportista(cliente, headers, nombre="Sin Medida")
    for peso in (80, 78):
        r = await cliente.post(f"/api/v1/deportistas/{con['id']}/mediciones", json={"peso": peso}, headers=headers)
        assert r.status_code == 201, r.text

    r = await cliente.get("/api/v1/deportistas/mediciones", headers=headers)
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["total"] == 2
    primero = cuerpo["items"][0]
    assert primero["nombre"] == "Con Medida"
    assert primero["total_mediciones"] == 2
    assert float(primero["peso"]) == 78  # la última
    assert cuerpo["items"][1]["ultima_fecha"] is None

    r = await cliente.get("/api/v1/deportistas/mediciones", params={"q": "Sin"}, headers=headers)
    assert [i["nombre"] for i in r.json()["items"]] == ["Sin Medida"]

    otro = await _jefe(cliente, fabrica)
    assert (await cliente.get("/api/v1/deportistas/mediciones", headers=otro)).json()["total"] == 0


@pytest.mark.asyncio
async def test_catalogo_de_clases(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _jefe(cliente, fabrica)
    r = await cliente.post(
        "/api/v1/clases/catalogo",
        json={"nombre": "Zumba", "descripcion": "Baile", "cupo_sugerido": 25, "duracion_minutos": 45},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    zumba = r.json()
    assert zumba["activo"] is True

    r = await cliente.post("/api/v1/clases/catalogo", json={"nombre": "zumba"}, headers=headers)
    assert r.status_code == 409
    assert r.json()["error"]["codigo"] == "CLASE_CATALOGO_DUPLICADA"

    r = await cliente.put(
        f"/api/v1/clases/catalogo/{zumba['id']}",
        json={"nombre": "Zumba", "cupo_sugerido": 30, "duracion_minutos": 45, "activo": False},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["cupo_sugerido"] == 30 and r.json()["activo"] is False

    otro = await _jefe(cliente, fabrica)
    assert (await cliente.get("/api/v1/clases/catalogo", headers=otro)).json() == []
    r = await cliente.put(
        f"/api/v1/clases/catalogo/{zumba['id']}", json={"nombre": "Ajena", "cupo_sugerido": 1, "duracion_minutos": 1}, headers=otro
    )
    assert r.status_code == 404
    # El mismo nombre sí puede existir en otro gimnasio.
    assert (await cliente.post("/api/v1/clases/catalogo", json={"nombre": "Zumba"}, headers=otro)).status_code == 201
