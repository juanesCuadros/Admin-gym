import pytest
from datetime import date, timedelta
from uuid import uuid4
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_obtener_plan_sin_plan_asignado(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica GET /my-gym/plan para un gimnasio nuevo sin suscripción en superadmin:
    - plan_actual es None
    - uso reporta conteo real de deportistas y staff activos
    - solicitud_pendiente es None
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    res = await cliente.get("/api/v1/my-gym/plan", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["plan_actual"] is None
    assert data["solicitud_pendiente"] is None
    assert data["uso"]["clientes_activos"] == 0
    assert data["uso"]["staff"] == 1  # El jefe creado


@pytest.mark.asyncio
async def test_obtener_plan_con_plan_asignado_y_metricas_uso(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica GET /my-gym/plan cuando el gimnasio tiene una suscripción vigente y deportistas:
    - plan_actual con datos del plan
    - uso refleja los deportistas activos y staff
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    recep = await fabrica.crear_staff(gym, rol="recepcionista")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # 1. Crear deportista activo y otro inactivo en platform
    async with fabrica.admin_engine.begin() as conn:
        dep_id1 = uuid4()
        dep_id2 = uuid4()
        await conn.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES 
                  (:id1, :gym, 'CC', '101', 'Atleta Activo', true, now(), true),
                  (:id2, :gym, 'CC', '102', 'Atleta Inactivo', true, now(), false)
            """),
            {"id1": dep_id1, "id2": dep_id2, "gym": gym.id}
        )

        # 2. Insertar plan en superadmin y suscripción para este gym
        plan_id = uuid4()
        codigo_plan = f"plan_{uuid4().hex[:6]}"
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (
                    id, codigo, nombre, tipo, precio, duracion_meses, max_clientes_activos, max_staff, activo, publico
                )
                VALUES (
                    :id, :cod, 'Plan Emprendedor', 'pago', 120000, 1, 150, 5, true, true
                )
            """),
            {"id": plan_id, "cod": codigo_plan}
        )
        await conn.execute(
            text("""
                INSERT INTO superadmin.suscripciones (
                    gimnasio_id, valor_mensual, tipo_inicio, vigente_desde, plan_id
                )
                VALUES (
                    :gym_sa, 120000, 'cliente_activo', current_date - 15, :plan_id
                )
            """),
            {"gym_sa": gym.superadmin_id, "plan_id": plan_id}
        )

    res = await cliente.get("/api/v1/my-gym/plan", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["plan_actual"] is not None
    assert data["plan_actual"]["codigo"] == codigo_plan
    assert data["plan_actual"]["nombre"] == "Plan Emprendedor"
    assert data["plan_actual"]["tipo"] == "pago"
    assert data["plan_actual"]["max_clientes_activos"] == 150
    assert data["plan_actual"]["max_staff"] == 5

    # Conteo de uso: solo activos (1 deportista activo, 2 staff: jefe + recep)
    assert data["uso"]["clientes_activos"] == 1
    assert data["uso"]["staff"] == 2


@pytest.mark.asyncio
async def test_listar_planes_disponibles_filtra_solo_publicos_activos_de_pago(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica GET /my-gym/planes:
    - Solo retorna planes con tipo = 'pago', activo = true, publico = true.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    id_pub = uuid4()
    cod_pub = f"pub_{uuid4().hex[:6]}"
    id_priv = uuid4()
    cod_priv = f"priv_{uuid4().hex[:6]}"
    id_inact = uuid4()
    cod_inact = f"inact_{uuid4().hex[:6]}"
    id_prueba = uuid4()
    cod_prueba = f"pru_{uuid4().hex[:6]}"

    async with fabrica.admin_engine.begin() as conn:
        # Plan elegible: pago, activo, público
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (id, codigo, nombre, tipo, precio, duracion_meses, activo, publico)
                VALUES (:id, :cod, 'Plan Publico', 'pago', 150000, 1, true, true)
            """),
            {"id": id_pub, "cod": cod_pub}
        )
        # Plan privado: no elegible en my-gym
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (id, codigo, nombre, tipo, precio, duracion_meses, activo, publico)
                VALUES (:id, :cod, 'Plan Privado Especial', 'pago', 80000, 1, true, false)
            """),
            {"id": id_priv, "cod": cod_priv}
        )
        # Plan inactivo
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (id, codigo, nombre, tipo, precio, duracion_meses, activo, publico)
                VALUES (:id, :cod, 'Plan Inactivo', 'pago', 200000, 1, false, true)
            """),
            {"id": id_inact, "cod": cod_inact}
        )
        # Plan tipo prueba
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (id, codigo, nombre, tipo, precio, dias_prueba, activo, publico)
                VALUES (:id, :cod, 'Plan Prueba Libre', 'prueba', 0, 5, true, true)
            """),
            {"id": id_prueba, "cod": cod_prueba}
        )

    res = await cliente.get("/api/v1/my-gym/planes", headers=headers)
    assert res.status_code == 200, res.text
    planes = res.json()

    codigos = [p["codigo"] for p in planes]
    assert cod_pub in codigos
    assert cod_priv not in codigos
    assert cod_inact not in codigos
    assert cod_prueba not in codigos

    item_pub = next(p for p in planes if p["codigo"] == cod_pub)
    assert item_pub["precio"] == 150000
    assert item_pub["duracion_meses"] == 1


@pytest.mark.asyncio
async def test_flujo_solicitud_plan_y_cancelacion(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica el flujo completo de solicitud y cancelación de cambio de plan:
    1. POST /my-gym/plan/solicitud crea solicitud pendiente (201) y audita.
    2. GET /my-gym/plan muestra la solicitud pendiente.
    3. Reintentar POST /my-gym/plan/solicitud devuelve 409 SOLICITUD_PENDIENTE_EXISTE.
    4. DELETE /my-gym/plan/solicitud cancela la solicitud (200).
    5. Segundo DELETE responde 404 SIN_SOLICITUD_PENDIENTE.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    plan_id = uuid4()
    plan_cod = f"pro_{uuid4().hex[:6]}"
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("""
                INSERT INTO superadmin.planes_suscripcion (id, codigo, nombre, tipo, precio, duracion_meses, activo, publico)
                VALUES (:id, :cod, 'Plan Pro Anual', 'pago', 1500000, 12, true, true)
            """),
            {"id": plan_id, "cod": plan_cod}
        )

    # 1. Crear solicitud
    r_sol = await cliente.post(
        "/api/v1/my-gym/plan/solicitud",
        json={"plan_id": str(plan_id), "nota": "Queremos subir al plan anual."},
        headers=headers
    )
    assert r_sol.status_code == 201, r_sol.text
    sol_id = r_sol.json()["id"]

    # 2. Verificar que se refleja en GET /my-gym/plan
    r_plan = await cliente.get("/api/v1/my-gym/plan", headers=headers)
    assert r_plan.status_code == 200
    info_plan = r_plan.json()
    assert info_plan["solicitud_pendiente"] is not None
    assert info_plan["solicitud_pendiente"]["id"] == sol_id
    assert info_plan["solicitud_pendiente"]["plan_nombre"] == "Plan Pro Anual"

    # 3. Intentar crear otra solicitud mientras hay una pendiente -> 409
    r_dup = await cliente.post(
        "/api/v1/my-gym/plan/solicitud",
        json={"plan_id": str(plan_id), "nota": "Otro intento"},
        headers=headers
    )
    assert r_dup.status_code == 409
    assert r_dup.json()["error"]["codigo"] == "SOLICITUD_PENDIENTE_EXISTE"

    # 4. Cancelar solicitud
    r_del = await cliente.delete("/api/v1/my-gym/plan/solicitud", headers=headers)
    assert r_del.status_code == 200

    # 5. Comprobar que en GET /my-gym/plan ya no hay solicitud pendiente
    r_plan_post = await cliente.get("/api/v1/my-gym/plan", headers=headers)
    assert r_plan_post.json()["solicitud_pendiente"] is None

    # 6. Intentar cancelar de nuevo sin pendiente -> 404
    r_del_again = await cliente.delete("/api/v1/my-gym/plan/solicitud", headers=headers)
    assert r_del_again.status_code == 404
    assert r_del_again.json()["error"]["codigo"] == "SIN_SOLICITUD_PENDIENTE"


@pytest.mark.asyncio
async def test_solicitar_plan_no_disponible_422(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que solicitar un plan inexistente, inactivo o no público responde 422 PLAN_NO_DISPONIBLE.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    # Plan ID que no existe
    r_inex = await cliente.post(
        "/api/v1/my-gym/plan/solicitud",
        json={"plan_id": str(uuid4())},
        headers=headers
    )
    assert r_inex.status_code == 422
    assert r_inex.json()["error"]["codigo"] == "PLAN_NO_DISPONIBLE"


@pytest.mark.asyncio
async def test_solicitud_plan_permisos_solo_jefe(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que recepcionista / entrenador no pueden crear ni cancelar solicitudes de plan (403 ROL_NO_AUTORIZADO).
    """
    gym = await fabrica.crear_gimnasio()
    recep = await fabrica.crear_staff(gym, rol="recepcionista")
    tok_recep = (await login(cliente, gym, recep)).json()["access_token"]
    headers_recep = {"Authorization": f"Bearer {tok_recep}"}

    r_post = await cliente.post(
        "/api/v1/my-gym/plan/solicitud",
        json={"plan_id": str(uuid4())},
        headers=headers_recep
    )
    assert r_post.status_code == 403
    assert r_post.json()["error"]["codigo"] == "ROL_NO_AUTORIZADO"

    r_del = await cliente.delete(
        "/api/v1/my-gym/plan/solicitud",
        headers=headers_recep
    )
    assert r_del.status_code == 403
    assert r_del.json()["error"]["codigo"] == "ROL_NO_AUTORIZADO"
