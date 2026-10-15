import pytest
from datetime import date, timedelta
from uuid import uuid4
from httpx import AsyncClient

from app.core.timezone import today_local
from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_tipo_documento_y_unicidad_por_gimnasio_ca1(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA1: Unicidad por gimnasio sobre (tipo_documento, documento).
    - Mismo tipo y documento en el mismo gimnasio -> 409 DOCUMENTO_YA_REGISTRADO.
    - Mismo documento con distinto tipo en el mismo gimnasio -> PERMITIDO.
    - Mismo tipo y documento en otro gimnasio -> PERMITIDO.
    """
    gym_a = await fabrica.crear_gimnasio()
    jefe_a = await fabrica.crear_staff(gym_a, rol="jefe")
    tok_a = (await login(cliente, gym_a, jefe_a)).json()["access_token"]
    headers_a = {"Authorization": f"Bearer {tok_a}"}

    gym_b = await fabrica.crear_gimnasio()
    jefe_b = await fabrica.crear_staff(gym_b, rol="jefe")
    tok_b = (await login(cliente, gym_b, jefe_b)).json()["access_token"]
    headers_b = {"Authorization": f"Bearer {tok_b}"}

    doc = "77889900"

    # 1. Crear en Gym A con CC
    r1 = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "CC",
            "documento": doc,
            "nombre": "Atleta CC Gym A",
            "consentimiento_1581": True,
        },
        headers=headers_a,
    )
    assert r1.status_code == 201, r1.text
    assert r1.json()["tipo_documento"] == "CC"
    assert r1.json()["documento"] == doc

    # 2. Intentar duplicar mismo tipo y documento en Gym A -> 409
    r_dup = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "CC",
            "documento": doc,
            "nombre": "Atleta Duplicado Gym A",
            "consentimiento_1581": True,
        },
        headers=headers_a,
    )
    assert r_dup.status_code == 409
    assert r_dup.json()["error"]["codigo"] == "DOCUMENTO_YA_REGISTRADO"

    # 3. Mismo documento con diferente tipo (TI) en Gym A -> Permitido
    r_ti = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "TI",
            "documento": doc,
            "nombre": "Atleta TI Gym A",
            "consentimiento_1581": True,
        },
        headers=headers_a,
    )
    assert r_ti.status_code == 201, r_ti.text
    assert r_ti.json()["tipo_documento"] == "TI"

    # 4. Mismo tipo (CC) y documento en Gym B -> Permitido (aislamiento multi-tenant)
    r_gym_b = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "CC",
            "documento": doc,
            "nombre": "Atleta CC Gym B",
            "consentimiento_1581": True,
        },
        headers=headers_b,
    )
    assert r_gym_b.status_code == 201, r_gym_b.text


@pytest.mark.asyncio
async def test_menor_edad_sin_acudiente_422_ca4(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA4: Menor de edad (< 18 en hora de Bogotá) sin acudiente responde 422 ACUDIENTE_REQUERIDO.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    hoy = today_local()
    nacimiento_16 = date(hoy.year - 16, hoy.month, hoy.day)

    r = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "TI",
            "documento": "11223344",
            "nombre": "Menor Sin Acudiente",
            "fecha_nacimiento": str(nacimiento_16),
            "consentimiento_1581": True,
        },
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["codigo"] == "ACUDIENTE_REQUERIDO"


@pytest.mark.asyncio
async def test_menor_edad_acudiente_sin_autorizacion_422_ca4(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA4: Menor de edad con acudiente pero autoriza=False responde 422 AUTORIZACION_ACUDIENTE_REQUERIDA.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    hoy = today_local()
    nacimiento_15 = date(hoy.year - 15, hoy.month, hoy.day)

    r = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "TI",
            "documento": "55667788",
            "nombre": "Menor Sin Autorizacion",
            "fecha_nacimiento": str(nacimiento_15),
            "consentimiento_1581": True,
            "acudiente": {
                "nombre": "Padre de Familia",
                "tipo_documento": "CC",
                "documento": "99881122",
                "telefono": "3001234567",
                "parentesco": "Padre",
                "autoriza": False,
            },
        },
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["codigo"] == "AUTORIZACION_ACUDIENTE_REQUERIDA"


@pytest.mark.asyncio
async def test_menor_edad_con_acudiente_exito_ca4(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA4: Menor de edad con acudiente completo y autoriza=True se registra exitosamente.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    hoy = today_local()
    nacimiento_14 = date(hoy.year - 14, hoy.month, hoy.day)

    r = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "TI",
            "documento": "33445566",
            "nombre": "Menor Autorizado",
            "fecha_nacimiento": str(nacimiento_14),
            "consentimiento_1581": True,
            "consentimiento_version": "1.2",
            "acudiente": {
                "nombre": "Madre de Familia",
                "tipo_documento": "CC",
                "documento": "88776655",
                "telefono": "3109876543",
                "parentesco": "Madre",
                "autoriza": True,
            },
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["nombre"] == "Menor Autorizado"
    assert data["tipo_documento"] == "TI"
    assert data["acudiente"] is not None
    assert data["acudiente"]["nombre"] == "Madre de Familia"
    assert data["acudiente"]["tipo_documento"] == "CC"
    assert data["acudiente"]["autoriza"] is True
    assert data["consentimiento_version"] == "1.2"
    assert data["consentimiento_registrado_por_nombre"] == "Staff jefe"


@pytest.mark.asyncio
async def test_consentimiento_version_y_registrado_por_rf19(cliente: AsyncClient, fabrica: Fabrica):
    """
    GW-RF-19: Trazabilidad de consentimiento: versión, fecha y usuario registrador.
    Verifica que se conserve y se devuelva en ficha GET /deportistas/{id}.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # 1. Crear deportista
    r_create = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "PAS",
            "documento": "P12345678",
            "nombre": "Deportista Pasaporte",
            "consentimiento_1581": True,
            "consentimiento_version": "2.1",
        },
        headers=headers,
    )
    assert r_create.status_code == 201
    dep_id = r_create.json()["id"]

    # 2. Consultar ficha
    r_ficha = await cliente.get(f"/api/v1/deportistas/{dep_id}", headers=headers)
    assert r_ficha.status_code == 200
    dep_info = r_ficha.json()["deportista"]
    assert dep_info["tipo_documento"] == "PAS"
    assert dep_info["consentimiento_version"] == "2.1"
    assert dep_info["consentimiento_fecha"] is not None
    assert dep_info["consentimiento_registrado_por_nombre"] == "Staff jefe"


@pytest.mark.asyncio
async def test_editar_deportista_tipo_documento_y_acudiente(cliente: AsyncClient, fabrica: Fabrica):
    """
    Edición de deportista: permite cambiar tipo_documento y acudiente respetando versionado.
    Valida colisión de documento al editar.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # Crear deportista 1
    r1 = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "CC",
            "documento": "10101010",
            "nombre": "Deportista Uno",
            "consentimiento_1581": True,
        },
        headers=headers,
    )
    assert r1.status_code == 201
    dep1_id = r1.json()["id"]
    version1 = r1.json()["version"]

    # Crear deportista 2
    r2 = await cliente.post(
        "/api/v1/deportistas",
        json={
            "tipo_documento": "CE",
            "documento": "20202020",
            "nombre": "Deportista Dos",
            "consentimiento_1581": True,
        },
        headers=headers,
    )
    assert r2.status_code == 201

    # Actualizar deportista 1: cambiar tipo a PPT
    r_edit = await cliente.put(
        f"/api/v1/deportistas/{dep1_id}",
        json={
            "version": version1,
            "tipo_documento": "PPT",
        },
        headers=headers,
    )
    assert r_edit.status_code == 200
    assert r_edit.json()["tipo_documento"] == "PPT"
    nueva_version = r_edit.json()["version"]

    # Intentar colisionar deportista 1 con los datos de deportista 2 (CE, 20202020)
    r_conflict = await cliente.put(
        f"/api/v1/deportistas/{dep1_id}",
        json={
            "version": nueva_version,
            "tipo_documento": "CE",
            "documento": "20202020",
        },
        headers=headers,
    )
    assert r_conflict.status_code == 409
    assert r_conflict.json()["error"]["codigo"] == "DOCUMENTO_YA_REGISTRADO"
