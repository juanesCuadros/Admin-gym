import pytest
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.core.timezone import today_local
from app.main import app
from app.modules.auth.service import AuthService
from app.modules.caja.reglas import calcular_vencimiento_renovacion_c2


# =============================================================================
# 1. TESTS UNITARIOS DE LA FUNCIÓN PURA (GW-RF-25 CA1 y CA2)
# =============================================================================

def test_regla_c2_unit_entro_en_gracia():
    """Entró el día venc+1 y renueva el venc+6 (g = 3) -> cuenta desde venc."""
    venc = date(2026, 5, 1)
    hoy = venc + timedelta(days=6)  # 2026-05-07
    dias_duracion = 30
    g = 3
    tuvo_checkin = True

    inicio, nuevo_venc = calcular_vencimiento_renovacion_c2(
        venc_actual=venc,
        hoy=hoy,
        dias_duracion=dias_duracion,
        dias_gracia_mora=g,
        tuvo_checkin_en_gracia=tuvo_checkin
    )
    assert inicio == venc
    assert nuevo_venc == venc + timedelta(days=dias_duracion)


def test_regla_c2_unit_no_entro_renueva_venc_mas_3():
    """No entró en la gracia y renueva el venc+3 (g = 3) -> cuenta desde venc+3 (hoy)."""
    venc = date(2026, 5, 1)
    hoy = venc + timedelta(days=3)  # 2026-05-04
    dias_duracion = 30
    g = 3
    tuvo_checkin = False

    inicio, nuevo_venc = calcular_vencimiento_renovacion_c2(
        venc_actual=venc,
        hoy=hoy,
        dias_duracion=dias_duracion,
        dias_gracia_mora=g,
        tuvo_checkin_en_gracia=tuvo_checkin
    )
    assert inicio == hoy
    assert nuevo_venc == hoy + timedelta(days=dias_duracion)


def test_regla_c2_unit_no_entro_renueva_venc_mas_10():
    """No entró en la gracia y renueva el venc+10 (g = 3) -> cuenta desde venc+10 (hoy)."""
    venc = date(2026, 5, 1)
    hoy = venc + timedelta(days=10)  # 2026-05-11
    dias_duracion = 30
    g = 3
    tuvo_checkin = False

    inicio, nuevo_venc = calcular_vencimiento_renovacion_c2(
        venc_actual=venc,
        hoy=hoy,
        dias_duracion=dias_duracion,
        dias_gracia_mora=g,
        tuvo_checkin_en_gracia=tuvo_checkin
    )
    assert inicio == hoy
    assert nuevo_venc == hoy + timedelta(days=dias_duracion)


def test_regla_c2_unit_vigente_suma_desde_vencimiento():
    """Renovar una membresía vigente: suma desde el vencimiento, sin perder días (CA1)."""
    venc = date(2026, 5, 20)
    hoy = date(2026, 5, 10)  # Vigente, faltan 10 días
    dias_duracion = 30
    g = 3
    tuvo_checkin = False

    inicio, nuevo_venc = calcular_vencimiento_renovacion_c2(
        venc_actual=venc,
        hoy=hoy,
        dias_duracion=dias_duracion,
        dias_gracia_mora=g,
        tuvo_checkin_en_gracia=tuvo_checkin
    )
    assert inicio == venc
    assert nuevo_venc == venc + timedelta(days=dias_duracion)


# =============================================================================
# 2. TESTS DE INTEGRACIÓN CON BASE DE DATOS Y ENDPOINT /caja/pagos-membresia
# =============================================================================

@pytest.mark.asyncio
async def test_regla_c2_integracion_pago_membresia():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        prefix = uuid.uuid4().hex[:6]
        gym_id = uuid.uuid4()
        recep_id = uuid.uuid4()
        dep1_id = uuid.uuid4()  # Atleta con check-in en gracia
        dep2_id = uuid.uuid4()  # Atleta sin check-in en gracia
        plan_id = uuid.uuid4()
        memb1_id = uuid.uuid4()
        memb2_id = uuid.uuid4()
        pwd_hash = hash_password("ClaveSegura123!")

        hoy = today_local()
        # Vencimiento hace 6 días (gracia = 3 días)
        venc_hace_6 = hoy - timedelta(days=6)
        dia_gracia_checkin = venc_hace_6 + timedelta(days=1)  # dentro de gracia

        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, dias_gracia_mora, activo)
                VALUES (:id, :nom, :sub, 3, true)
            """), {"id": gym_id, "nom": f"Gym C2 {prefix}", "sub": f"c2-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recep C2', true)
            """), {"id": recep_id, "gym": gym_id, "mail": f"recep_c2_{prefix}@test.com", "pwd": pwd_hash})

            # Plan
            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 100000, 30, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id, "nom": f"Plan Mensual {prefix}"})

            # Deportistas
            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo)
                VALUES
                  (:d1, :gym, :doc1, 'Atleta Gracia Con Checkin', 'd1@test.com', true, now(), true),
                  (:d2, :gym, :doc2, 'Atleta Gracia Sin Checkin', 'd2@test.com', true, now(), true)
            """), {
                "d1": dep1_id, "doc1": f"CC1-{prefix}",
                "d2": dep2_id, "doc2": f"CC2-{prefix}",
                "gym": gym_id
            })

            # Membresías vencidas hace 6 días
            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
                VALUES
                  (:m1, :gym, :d1, :p, :fi, :fv, false),
                  (:m2, :gym, :d2, :p, :fi, :fv, false)
            """), {
                "m1": memb1_id, "d1": dep1_id,
                "m2": memb2_id, "d2": dep2_id,
                "gym": gym_id, "p": plan_id,
                "fi": venc_hace_6 - timedelta(days=30),
                "fv": venc_hace_6
            })

            # Registrar checkin para dep1 en su día de gracia
            # ts_utc correspondiente al mediodía del día dia_gracia_checkin en Bogotá (UTC-5 -> 17:00 UTC)
            ts_checkin = datetime(dia_gracia_checkin.year, dia_gracia_checkin.month, dia_gracia_checkin.day, 17, 0, 0, tzinfo=timezone.utc)
            await session.execute(text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, registrado_por, ts_utc)
                VALUES (:gym, :dep, 'ingreso', 'manual', 'alerta_mora', :staff, :ts)
            """), {
                "gym": gym_id, "dep": dep1_id, "staff": recep_id, "ts": ts_checkin
            })

            await AuthService._seed_permisos_en_transaccion(session, gym_id)
            await session.commit()

        tok_recep = create_access_token(str(recep_id), str(gym_id), "recepcionista")
        headers = {"Authorization": f"Bearer {tok_recep}"}

        # Abrir turno de caja
        r_abrir = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 20000}, headers=headers)
        assert r_abrir.status_code == 201

        # Caso 1: Renovar dep1 (tuvo checkin en gracia) -> cuenta desde venc_hace_6
        r_pago1 = await client.post(
            "/api/v1/caja/pagos-membresia",
            json={
                "membresia_id": str(memb1_id),
                "monto": 100000,
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "dias_agregados": 30,
                "valor_recibido": 100000
            },
            headers={**headers, "X-Idempotency-Key": f"c2-p1-{prefix}"}
        )
        assert r_pago1.status_code == 201
        data1 = r_pago1.json()
        # Vencimiento debe ser venc_hace_6 + 30 días
        venc_esperado_1 = venc_hace_6 + timedelta(days=30)
        assert data1["nueva_fecha_vencimiento"] == venc_esperado_1.strftime("%Y-%m-%d")

        # Caso 2: Renovar dep2 (NO tuvo checkin en gracia) -> cuenta desde hoy
        r_pago2 = await client.post(
            "/api/v1/caja/pagos-membresia",
            json={
                "membresia_id": str(memb2_id),
                "monto": 100000,
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "dias_agregados": 30,
                "valor_recibido": 100000
            },
            headers={**headers, "X-Idempotency-Key": f"c2-p2-{prefix}"}
        )
        assert r_pago2.status_code == 201
        data2 = r_pago2.json()
        # Vencimiento debe ser hoy + 30 días
        venc_esperado_2 = hoy + timedelta(days=30)
        assert data2["nueva_fecha_vencimiento"] == venc_esperado_2.strftime("%Y-%m-%d")
