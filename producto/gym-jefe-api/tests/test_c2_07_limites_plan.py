import pytest
from datetime import date
from uuid import uuid4
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_limite_plan_clientes_bloquea_creacion_409(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que al alcanzar max_clientes_activos del plan, la creación de nuevos deportistas
    responda 409 LIMITE_PLAN_CLIENTES con detalles {limite, actuales, plan_nombre}.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # Asignar plan con límite de 2 clientes activos
    plan_id = uuid4()
    plan_cod = f"lim_{uuid4().hex[:6]}"
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (
                    id, codigo, nombre, tipo, precio, duracion_meses, max_clientes_activos, max_staff, activo, publico
                )
                VALUES (:id, :cod, 'Plan Micro', 'pago', 50000, 1, 2, 5, true, true)
            """),
            {"id": plan_id, "cod": plan_cod}
        )
        await conn.execute(
            text("""
                INSERT INTO superadmin.suscripciones (
                    gimnasio_id, valor_mensual, tipo_inicio, vigente_desde, plan_id
                )
                VALUES (:gym_sa, 50000, 'cliente_activo', current_date - 1, :plan_id)
            """),
            {"gym_sa": gym.superadmin_id, "plan_id": plan_id}
        )

    # 1. Crear 1er cliente -> éxito
    r1 = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": "111", "nombre": "Cliente 1", "consentimiento_1581": True},
        headers=headers
    )
    assert r1.status_code == 201, r1.text

    # 2. Crear 2do cliente -> éxito (llegó a 2)
    r2 = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": "222", "nombre": "Cliente 2", "consentimiento_1581": True},
        headers=headers
    )
    assert r2.status_code == 201, r2.text

    # 3. Intentar crear 3er cliente -> 409 LIMITE_PLAN_CLIENTES
    r3 = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": "333", "nombre": "Cliente 3", "consentimiento_1581": True},
        headers=headers
    )
    assert r3.status_code == 409
    err = r3.json()["error"]
    assert err["codigo"] == "LIMITE_PLAN_CLIENTES"
    assert err["detalles"]["limite"] == 2
    assert err["detalles"]["actuales"] == 2
    assert err["detalles"]["plan_nombre"] == "Plan Micro"


@pytest.mark.asyncio
async def test_sin_limite_plan_clientes_permite_crear(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que si no hay plan asignado o max_clientes_activos es NULL, se pueden crear clientes libremente.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    r = await cliente.post(
        "/api/v1/deportistas",
        json={"tipo_documento": "CC", "documento": "999", "nombre": "Cliente Libre", "consentimiento_1581": True},
        headers=headers
    )
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_limite_plan_staff_bloquea_creacion_409(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que al alcanzar max_staff del plan, la creación de nuevo staff responda
    409 LIMITE_PLAN_STAFF con detalles {limite, actuales, plan_nombre}.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # Asignar plan con límite de 2 staff (el jefe ya cuenta como 1)
    plan_id = uuid4()
    plan_cod = f"stf_{uuid4().hex[:6]}"
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (
                    id, codigo, nombre, tipo, precio, duracion_meses, max_clientes_activos, max_staff, activo, publico
                )
                VALUES (:id, :cod, 'Plan Solo Jefe y Uno Mas', 'pago', 70000, 1, 100, 2, true, true)
            """),
            {"id": plan_id, "cod": plan_cod}
        )
        await conn.execute(
            text("""
                INSERT INTO superadmin.suscripciones (
                    gimnasio_id, valor_mensual, tipo_inicio, vigente_desde, plan_id
                )
                VALUES (:gym_sa, 70000, 'cliente_activo', current_date - 1, :plan_id)
            """),
            {"gym_sa": gym.superadmin_id, "plan_id": plan_id}
        )

    # 1. Crear 1 recepcionista -> éxito (total staff activos = 2)
    r1 = await cliente.post(
        "/api/v1/personal",
        json={"nombre": "Recepcionista 1", "correo": "recep1@gym.com", "rol": "recepcionista", "password": "Clave-Segura-123"},
        headers=headers
    )
    assert r1.status_code == 201, r1.text

    # 2. Intentar crear entrenador -> 409 LIMITE_PLAN_STAFF
    r2 = await cliente.post(
        "/api/v1/personal",
        json={"nombre": "Entrenador 1", "correo": "coach1@gym.com", "rol": "entrenador", "password": "Clave-Segura-123"},
        headers=headers
    )
    assert r2.status_code == 409
    err = r2.json()["error"]
    assert err["codigo"] == "LIMITE_PLAN_STAFF"
    assert err["detalles"]["limite"] == 2
    assert err["detalles"]["actuales"] == 2
    assert err["detalles"]["plan_nombre"] == "Plan Solo Jefe y Uno Mas"


@pytest.mark.asyncio
async def test_sin_limite_plan_staff_permite_crear(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que si no hay plan asignado o max_staff es NULL, se puede registrar staff sin bloqueo.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    r = await cliente.post(
        "/api/v1/personal",
        json={"nombre": "Recepcionista Libre", "correo": "recep_libre@gym.com", "rol": "recepcionista", "password": "Clave-Segura-123"},
        headers=headers
    )
    assert r.status_code == 201
