import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_obtener_info_parametros_por_defecto(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que GET /my-gym/info retorne los 5 nuevos parámetros con sus valores por defecto:
    - minimo_dias_congelamiento: 1
    - permitir_descuentos: False
    - tope_descuento_pct: 0
    - ventana_reserva_dias: 7
    - limite_cancelar_reserva_horas: 2
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    res = await cliente.get("/api/v1/my-gym/info", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["minimo_dias_congelamiento"] == 1
    assert data["permitir_descuentos"] is False
    assert data["tope_descuento_pct"] == 0
    assert data["ventana_reserva_dias"] == 7
    assert data["limite_cancelar_reserva_horas"] == 2


@pytest.mark.asyncio
async def test_actualizar_parametros_operativos_exito(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que PATCH /my-gym/parametros actualice los 5 nuevos parámetros y gestione OCC.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    info_ini = (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()
    version_ini = info_ini["version"]

    payload = {
        "version": version_ini,
        "dias_gracia_mora": 5,
        "tope_dias_congelamiento": 30,
        "dias_umbral_por_vencer": 7,
        "duracion_sesion_minutos": 120,
        "minimo_dias_congelamiento": 3,
        "permitir_descuentos": True,
        "tope_descuento_pct": 20,
        "ventana_reserva_dias": 10,
        "limite_cancelar_reserva_horas": 4,
    }

    res = await cliente.patch("/api/v1/my-gym/parametros", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    actualizado = res.json()

    assert actualizado["version"] == version_ini + 1
    assert actualizado["minimo_dias_congelamiento"] == 3
    assert actualizado["tope_dias_congelamiento"] == 30
    assert actualizado["permitir_descuentos"] is True
    assert actualizado["tope_descuento_pct"] == 20
    assert actualizado["ventana_reserva_dias"] == 10
    assert actualizado["limite_cancelar_reserva_horas"] == 4

    # Verificar persistencia en GET /info
    info_post = (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()
    assert info_post["version"] == version_ini + 1
    assert info_post["minimo_dias_congelamiento"] == 3
    assert info_post["permitir_descuentos"] is True
    assert info_post["tope_descuento_pct"] == 20
    assert info_post["ventana_reserva_dias"] == 10
    assert info_post["limite_cancelar_reserva_horas"] == 4


@pytest.mark.asyncio
async def test_actualizar_parametros_parcial(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que se puedan actualizar únicamente ciertos parámetros sin sobrescribir los otros.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    info_ini = (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()
    version_ini = info_ini["version"]

    payload = {
        "version": version_ini,
        "tope_descuento_pct": 15,
        "permitir_descuentos": True,
    }

    res = await cliente.patch("/api/v1/my-gym/parametros", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["version"] == version_ini + 1
    assert data["tope_descuento_pct"] == 15
    assert data["permitir_descuentos"] is True
    # Los demás se preservan
    assert data["minimo_dias_congelamiento"] == 1
    assert data["ventana_reserva_dias"] == 7
    assert data["limite_cancelar_reserva_horas"] == 2


@pytest.mark.asyncio
async def test_parametros_fuera_de_rango_422(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que valores fuera de rango o violaciones de restricción respondan con 422.
    - minimo_dias_congelamiento < 1
    - tope_descuento_pct > 100 o < 0
    - ventana_reserva_dias < 0
    - limite_cancelar_reserva_horas < 0
    - tope_dias_congelamiento < minimo_dias_congelamiento
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    info_ini = (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()
    ver = info_ini["version"]

    # 1. minimo_dias_congelamiento < 1
    r1 = await cliente.patch("/api/v1/my-gym/parametros", json={"version": ver, "minimo_dias_congelamiento": 0}, headers=headers)
    assert r1.status_code == 422

    # 2. tope_descuento_pct > 100
    r2 = await cliente.patch("/api/v1/my-gym/parametros", json={"version": ver, "tope_descuento_pct": 105}, headers=headers)
    assert r2.status_code == 422

    # 3. tope_descuento_pct < 0
    r3 = await cliente.patch("/api/v1/my-gym/parametros", json={"version": ver, "tope_descuento_pct": -5}, headers=headers)
    assert r3.status_code == 422

    # 4. ventana_reserva_dias < 0
    r4 = await cliente.patch("/api/v1/my-gym/parametros", json={"version": ver, "ventana_reserva_dias": -1}, headers=headers)
    assert r4.status_code == 422

    # 5. limite_cancelar_reserva_horas < 0
    r5 = await cliente.patch("/api/v1/my-gym/parametros", json={"version": ver, "limite_cancelar_reserva_horas": -2}, headers=headers)
    assert r5.status_code == 422

    # 6. tope_dias_congelamiento < minimo_dias_congelamiento (en el mismo request)
    r6 = await cliente.patch(
        "/api/v1/my-gym/parametros",
        json={"version": ver, "minimo_dias_congelamiento": 10, "tope_dias_congelamiento": 5},
        headers=headers,
    )
    assert r6.status_code == 422
