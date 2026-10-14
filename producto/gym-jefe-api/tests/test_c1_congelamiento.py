import pytest
import uuid
from datetime import date, timedelta
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.core.timezone import today_local
from app.main import app
from app.modules.auth.service import AuthService


@pytest.mark.asyncio
async def test_congelamiento_solo_activo_o_por_vencer_gw_rf_26_ca1():
    """
    GW-RF-26 CA1: Solo se puede congelar una membresía en estado 'activo' o 'por_vencer'.
    Si está en gracia (mora) o vencida, debe ser rechazada con 422 MEMBRESIA_NO_CONGELABLE.
    """
    gym_id = uuid.uuid4()
    jefe_id = uuid.uuid4()
    plan_id = uuid.uuid4()
    prefix = uuid.uuid4().hex[:6]
    hoy = today_local()

    pwd_hash = hash_password("secreto123")

    # Creamos 4 deportistas con diferentes estados:
    # dep_activo: vence en 20 días
    # dep_por_vencer: vence en 3 días (umbral por defecto es 5)
    # dep_en_gracia: vence hace 2 días (gracia es 3)
    # dep_vencido: vence hace 10 días
    dep_activo_id = uuid.uuid4()
    dep_por_vencer_id = uuid.uuid4()
    dep_gracia_id = uuid.uuid4()
    dep_vencido_id = uuid.uuid4()

    m_activo_id = uuid.uuid4()
    m_por_vencer_id = uuid.uuid4()
    m_gracia_id = uuid.uuid4()
    m_vencido_id = uuid.uuid4()

    async with async_session_maker() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, dias_gracia_mora, dias_umbral_por_vencer, minimo_dias_congelamiento, tope_dias_congelamiento, activo)
                VALUES (:id, :nom, :sub, 3, 5, 3, 30, true)
            """), {"id": gym_id, "nom": f"Gym CongCA1 {prefix}", "sub": f"c1-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Congelador', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_cg_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 100000, 30, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id, "nom": f"Plan Cong {prefix}"})

            for did, doc in [
                (dep_activo_id, f"ACT-{prefix}"),
                (dep_por_vencer_id, f"PV-{prefix}"),
                (dep_gracia_id, f"GRA-{prefix}"),
                (dep_vencido_id, f"VEN-{prefix}"),
            ]:
                await session.execute(text("""
                    INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo)
                    VALUES (:id, :gym, :doc, 'Atleta Test', 'at@test.com', true, now(), true)
                """), {"id": did, "gym": gym_id, "doc": doc})

            # Membresía activa (vence en 20 días)
            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, plan_precio_vendido, plan_duracion_dias_vendida, cancelada)
                VALUES (:id, :gym, :dep, :plan, :fini, :fvenc, 100000, 30, false)
            """), {"id": m_activo_id, "gym": gym_id, "dep": dep_activo_id, "plan": plan_id, "fini": hoy - timedelta(days=10), "fvenc": hoy + timedelta(days=20)})

            # Membresía por vencer (vence en 3 días)
            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, plan_precio_vendido, plan_duracion_dias_vendida, cancelada)
                VALUES (:id, :gym, :dep, :plan, :fini, :fvenc, 100000, 30, false)
            """), {"id": m_por_vencer_id, "gym": gym_id, "dep": dep_por_vencer_id, "plan": plan_id, "fini": hoy - timedelta(days=27), "fvenc": hoy + timedelta(days=3)})

            # Membresía en gracia / mora (vence hace 2 días, gracia es 3)
            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, plan_precio_vendido, plan_duracion_dias_vendida, cancelada)
                VALUES (:id, :gym, :dep, :plan, :fini, :fvenc, 100000, 30, false)
            """), {"id": m_gracia_id, "gym": gym_id, "dep": dep_gracia_id, "plan": plan_id, "fini": hoy - timedelta(days=32), "fvenc": hoy - timedelta(days=2)})

            # Membresía vencida (vence hace 10 días)
            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, plan_precio_vendido, plan_duracion_dias_vendida, cancelada)
                VALUES (:id, :gym, :dep, :plan, :fini, :fvenc, 100000, 30, false)
            """), {"id": m_vencido_id, "gym": gym_id, "dep": dep_vencido_id, "plan": plan_id, "fini": hoy - timedelta(days=40), "fvenc": hoy - timedelta(days=10)})

    token = create_access_token(str(jefe_id), str(gym_id), "jefe")
    headers = {"Authorization": f"Bearer {token}", "X-Gimnasio-ID": str(gym_id)}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver/api/v1") as client:
        # 1. Congelar membresía ACTIVA -> Debe permitirlo (201 Created)
        r_act = await client.post(f"/membresias/{m_activo_id}/congelar", json={"motivo": "Viaje trabajo", "dias": 5}, headers=headers)
        assert r_act.status_code == 201, r_act.text
        assert r_act.json()["vigente"] is True

        # 2. Congelar membresía POR_VENCER -> Debe permitirlo (201 Created)
        r_pv = await client.post(f"/membresias/{m_por_vencer_id}/congelar", json={"motivo": "Cirugía dental", "dias": 5}, headers=headers)
        assert r_pv.status_code == 201, r_pv.text
        assert r_pv.json()["vigente"] is True

        # 3. Intentar congelar membresía EN_GRACIA (mora) -> Debe rechazar con 422 MEMBRESIA_NO_CONGELABLE
        r_gra = await client.post(f"/membresias/{m_gracia_id}/congelar", json={"motivo": "No alcancé a pagar", "dias": 5}, headers=headers)
        assert r_gra.status_code == 422, r_gra.text
        err_gra = r_gra.json().get("error", {})
        assert err_gra.get("codigo") == "MEMBRESIA_NO_CONGELABLE"

        # 4. Intentar congelar membresía VENCIDA -> Debe rechazar con 422 MEMBRESIA_NO_CONGELABLE
        r_ven = await client.post(f"/membresias/{m_vencido_id}/congelar", json={"motivo": "Quiero congelar", "dias": 5}, headers=headers)
        assert r_ven.status_code == 422, r_ven.text
        err_ven = r_ven.json().get("error", {})
        assert err_ven.get("codigo") == "MEMBRESIA_NO_CONGELABLE"


@pytest.mark.asyncio
async def test_congelamiento_minimo_dias_y_tope_gw_rf_26_ca3():
    """
    GW-RF-26 CA3: Un congelamiento por debajo del mínimo (minimo_dias_congelamiento)
    o que haga superar el tope acumulado se rechaza con 422.
    """
    gym_id = uuid.uuid4()
    jefe_id = uuid.uuid4()
    plan_id = uuid.uuid4()
    dep_id = uuid.uuid4()
    memb_id = uuid.uuid4()
    prefix = uuid.uuid4().hex[:6]
    hoy = today_local()

    pwd_hash = hash_password("secreto123")

    async with async_session_maker() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            # Mínimo de 5 días, tope acumulado de 15 días
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, minimo_dias_congelamiento, tope_dias_congelamiento, activo)
                VALUES (:id, :nom, :sub, 5, 15, true)
            """), {"id": gym_id, "nom": f"Gym CongMin {prefix}", "sub": f"cmin-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Min', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_cmin_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 100000, 60, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id, "nom": f"Plan CongMin {prefix}"})

            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :gym, :doc, 'Atleta Min', 'at_min@test.com', true, now(), true)
            """), {"id": dep_id, "gym": gym_id, "doc": f"DOC-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, plan_precio_vendido, plan_duracion_dias_vendida, cancelada)
                VALUES (:id, :gym, :dep, :plan, :fini, :fvenc, 100000, 60, false)
            """), {"id": memb_id, "gym": gym_id, "dep": dep_id, "plan": plan_id, "fini": hoy, "fvenc": hoy + timedelta(days=60)})

    token = create_access_token(str(jefe_id), str(gym_id), "jefe")
    headers = {"Authorization": f"Bearer {token}", "X-Gimnasio-ID": str(gym_id)}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver/api/v1") as client:
        # 1. Congelar por 3 días (mínimo es 5) -> Debe rechazar con 422 CONGELAMIENTO_MENOR_MINIMO
        r_menor = await client.post(
            f"/membresias/{memb_id}/congelar",
            json={"motivo": "Viaje corto", "dias": 3},
            headers=headers
        )
        assert r_menor.status_code == 422, r_menor.text
        err_menor = r_menor.json().get("error", {})
        assert err_menor.get("codigo") == "CONGELAMIENTO_MENOR_MINIMO"

        # 2. Congelar por 20 días (tope es 15) -> Debe rechazar con 422 TOPE_CONGELAMIENTO_ALCANZADO
        r_tope = await client.post(
            f"/membresias/{memb_id}/congelar",
            json={"motivo": "Vacaciones largas", "dias": 20},
            headers=headers
        )
        assert r_tope.status_code == 422, r_tope.text
        err_tope = r_tope.json().get("error", {})
        assert err_tope.get("codigo") == "TOPE_CONGELAMIENTO_ALCANZADO"

        # 3. Congelar por 7 días (cumple >= 5 y <= 15) -> Debe aceptar (201 Created)
        r_ok = await client.post(
            f"/membresias/{memb_id}/congelar",
            json={"motivo": "Reposo médico", "dias": 7},
            headers=headers
        )
        assert r_ok.status_code == 201, r_ok.text
        assert r_ok.json()["vigente"] is True
        assert r_ok.json()["dias"] == 7
