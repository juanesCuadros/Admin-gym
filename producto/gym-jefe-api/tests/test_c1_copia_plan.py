import pytest
import uuid
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.main import app


@pytest.mark.asyncio
async def test_copia_plan_en_la_venta_gw_rf_24_ca2():
    """
    GW-RF-24 CA2: La venta guarda una copia del plan (precio y duración);
    editar el plan después en el catálogo no afecta lo ya vendido.
    Aplica tanto a asignación inicial como a cambio de plan.
    """
    gym_id = uuid.uuid4()
    jefe_id = uuid.uuid4()
    plan_a_id = uuid.uuid4()
    plan_b_id = uuid.uuid4()
    dep_id = uuid.uuid4()
    prefix = uuid.uuid4().hex[:6]

    pwd_hash = hash_password("secreto123")

    async with async_session_maker() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id, :nom, :sub, true)
            """), {"id": gym_id, "nom": f"Gym CopiaPlan {prefix}", "sub": f"cp-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Plan', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_cp_{prefix}@test.com", "pwd": pwd_hash})

            # Plan A inicial: $85.000, 30 días
            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 85000, 30, 'individual', 1, true)
            """), {"id": plan_a_id, "gym": gym_id, "nom": f"Plan Bronce {prefix}"})

            # Plan B: $200.000, 90 días
            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 200000, 90, 'individual', 1, true)
            """), {"id": plan_b_id, "gym": gym_id, "nom": f"Plan Oro {prefix}"})

            # Deportista
            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :gym, :doc, 'Deportista CopiaPlan', 'dep_cp@test.com', true, now(), true)
            """), {"id": dep_id, "gym": gym_id, "doc": f"DOC-{prefix}"})

    token_jefe = create_access_token(str(jefe_id), str(gym_id), "jefe")
    headers = {
        "Authorization": f"Bearer {token_jefe}",
        "X-Gimnasio-ID": str(gym_id)
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver/api/v1") as client:
        # Vender un plan cobra en el mismo paso: exige turno propio abierto.
        r_turno = await client.post("/caja/turnos/abrir", json={"base_inicial": 0}, headers=headers)
        assert r_turno.status_code == 201, r_turno.text

        # 1. Asignar Plan A
        r_asig = await client.post(
            "/membresias/asignar",
            json={
                "deportista_id": str(dep_id),
                "plan_id": str(plan_a_id),
                "pago": {"monto": 85000, "metodo": "efectivo", "tipo_medio": "efectivo"},
            },
            headers={**headers, "X-Idempotency-Key": f"venta-a-{prefix}"}
        )
        assert r_asig.status_code == 201, r_asig.text
        m_asig = r_asig.json()
        membresia_1_id = m_asig["id"]
        assert Decimal(str(m_asig["plan_precio_vendido"])) == Decimal("85000")
        assert m_asig["plan_duracion_dias_vendida"] == 30

        # 2. Modificar el Plan A en catálogo (precio a 130000 y duración a 45 días)
        async with async_session_maker() as session:
            async with session.begin():
                await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
                await session.execute(text("""
                    UPDATE platform.planes
                    SET precio = 130000, duracion_dias = 45, nombre = :nom
                    WHERE id = :id
                """), {"id": plan_a_id, "nom": f"Plan Bronce Modificado {prefix}"})

        # 3. Consultar Ficha de la membresía: los valores vendidos NO deben haber cambiado
        r_ficha = await client.get(f"/membresias/{membresia_1_id}", headers=headers)
        assert r_ficha.status_code == 200, r_ficha.text
        ficha = r_ficha.json()["membresia"]
        assert Decimal(str(ficha["plan_precio_vendido"])) == Decimal("85000")
        assert ficha["plan_duracion_dias_vendida"] == 30
        assert ficha["plan_nombre"] == f"Plan Bronce Modificado {prefix}"

        # 4. Consultar listado de membresías del gimnasio: también conserva la copia
        r_list = await client.get("/membresias", headers=headers)
        assert r_list.status_code == 200, r_list.text
        items = r_list.json()["items"]
        item_m1 = next(it for it in items if it["id"] == membresia_1_id)
        assert Decimal(str(item_m1["plan_precio_vendido"])) == Decimal("85000")
        assert item_m1["plan_duracion_dias_vendida"] == 30

        # 5. Cambiar al Plan B: debe capturar $200.000 y 90 días
        r_cambio = await client.post(
            f"/membresias/{membresia_1_id}/cambiar-plan",
            json={
                "nuevo_plan_id": str(plan_b_id),
                "motivo": "Upgrade a Plan Oro",
                "pago": {"monto": 200000, "metodo": "efectivo", "tipo_medio": "efectivo"},
            },
            headers={**headers, "X-Idempotency-Key": f"cambio-b-{prefix}"}
        )
        assert r_cambio.status_code == 200, r_cambio.text
        m_cambio = r_cambio.json()
        membresia_2_id = m_cambio["id"]
        assert Decimal(str(m_cambio["plan_precio_vendido"])) == Decimal("200000")
        assert m_cambio["plan_duracion_dias_vendida"] == 90

        # 6. Modificar Plan B en catálogo a $350.000
        async with async_session_maker() as session:
            async with session.begin():
                await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
                await session.execute(text("""
                    UPDATE platform.planes
                    SET precio = 350000
                    WHERE id = :id
                """), {"id": plan_b_id})

        # 7. Consultar Ficha de la nueva membresía: conserva $200.000 y 90 días
        r_ficha_2 = await client.get(f"/membresias/{membresia_2_id}", headers=headers)
        assert r_ficha_2.status_code == 200, r_ficha_2.text
        ficha_2 = r_ficha_2.json()["membresia"]
        assert Decimal(str(ficha_2["plan_precio_vendido"])) == Decimal("200000")
        assert ficha_2["plan_duracion_dias_vendida"] == 90
