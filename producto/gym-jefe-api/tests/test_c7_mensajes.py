"""Pendiente #2 y #3: los errores que ve el usuario están en español y sin términos técnicos."""
import pytest
from httpx import AsyncClient

from app.core.exceptions import traducir_error_validacion
from tests.conftest import Fabrica, login


async def _headers_jefe(cliente: AsyncClient, fabrica: Fabrica) -> dict:
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_422_por_campo_en_espanol(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _headers_jefe(cliente, fabrica)
    r = await cliente.post(
        "/api/v1/planes",
        json={"nombre": "Mensual", "precio": -5, "tipo": "semanal"},
        headers=headers,
    )
    assert r.status_code == 422
    error = r.json()["error"]
    assert error["codigo"] == "ERROR_VALIDACION_CAMPOS"
    por_campo = {d["campo"].split(" -> ")[-1]: d["mensaje"] for d in error["detalles"]}
    assert por_campo["precio"] == "Debe ser mayor o igual a 0."
    assert por_campo["duracion_dias"] == "Este dato es obligatorio."
    assert por_campo["tipo"].startswith("Elige una de las opciones: individual, pareja o familiar")
    assert error["mensaje"].startswith("Revisa «")
    assert "dato(s) más" in error["mensaje"]


@pytest.mark.asyncio
async def test_plan_duplicado_sin_lenguaje_tecnico(cliente: AsyncClient, fabrica: Fabrica):
    headers = await _headers_jefe(cliente, fabrica)
    plan = {"nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual"}
    assert (await cliente.post("/api/v1/planes", json=plan, headers=headers)).status_code == 201
    r = await cliente.post("/api/v1/planes", json=plan, headers=headers)
    assert r.status_code == 409
    mensaje = r.json()["error"]["mensaje"]
    assert mensaje.startswith("Ya existe un plan con el nombre")
    assert "unicidad" not in mensaje


def test_validador_propio_sin_prefijo_en_ingles():
    error = {"type": "value_error", "msg": "Value error, El nombre del plan no puede estar vacío.", "loc": ("body", "nombre")}
    assert traducir_error_validacion(error) == "El nombre del plan no puede estar vacío."
    correo = {"type": "value_error", "msg": "value is not a valid email address: An email address must have an @-sign."}
    assert traducir_error_validacion(correo) == "El correo electrónico no es válido."
    assert traducir_error_validacion({"type": "tipo_raro", "msg": "x"}) == "El valor no es válido."
