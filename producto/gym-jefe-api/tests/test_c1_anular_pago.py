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
async def test_anular_pago_recalcula_historial_y_registra_reverso_turno_actual():
    """
    GW-RF-16:
    - CA1: Exige permiso y motivo, queda en auditoría. El vencimiento se recalcula desde el historial.
    - CA2: Accesos previos se conservan.
    - CA3: El reverso se registra en el turno abierto actual.
    """
    gym_id = uuid.uuid4()
    cajero_id = uuid.uuid4()
    plan_id = uuid.uuid4()
    dep_id = uuid.uuid4()
    memb_id = uuid.uuid4()
    prefix = uuid.uuid4().hex[:6]

    hoy = today_local()
    venc_inicial = hoy - timedelta(days=10)
    inicio_memb = venc_inicial - timedelta(days=30)

    pwd_hash = hash_password("secreto123")

    async with async_session_maker() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, dias_gracia_mora, activo)
                VALUES (:id, :nom, :sub, 3, true)
            """), {"id": gym_id, "nom": f"Gym Anular {prefix}", "sub": f"an-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Caja', true)
            """), {"id": cajero_id, "gym": gym_id, "mail": f"cajero_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 90000, 30, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id, "nom": f"Plan Mes {prefix}"})

            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :gym, :doc, 'Atleta Anulacion', 'atleta@test.com', true, now(), true)
            """), {"id": dep_id, "gym": gym_id, "doc": f"DOC-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.membresias (
                    id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento,
                    plan_precio_vendido, plan_duracion_dias_vendida, cancelada
                ) VALUES (
                    :id, :gym, :dep, :plan, :fini, :fvenc, 90000, 30, false
                )
            """), {
                "id": memb_id, "gym": gym_id, "dep": dep_id,
                "plan": plan_id, "fini": inicio_memb, "fvenc": venc_inicial
            })

    token_cajero = create_access_token(str(cajero_id), str(gym_id), "jefe")
    headers = {
        "Authorization": f"Bearer {token_cajero}",
        "X-Gimnasio-ID": str(gym_id)
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver/api/v1") as client:
        # 1. Abrir Turno 1
        r_abrir1 = await client.post(
            "/caja/turnos/abrir",
            json={"base_inicial": 50000},
            headers=headers
        )
        assert r_abrir1.status_code == 201, r_abrir1.text
        turno1_id = r_abrir1.json()["id"]

        # 2. Registrar pago de membresía en Turno 1 (30 días, efectivo $90.000)
        # Como venc_inicial fue hace 10 días (fuera de gracia), Rule C2 renueva desde HOY -> hoy + 30 días
        idemp_pago = f"pay-{uuid.uuid4().hex}"
        r_pago = await client.post(
            "/caja/pagos-membresia",
            json={
                "membresia_id": str(memb_id),
                "monto": 90000,
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "dias_agregados": 30,
                "valor_recibido": 90000
            },
            headers={**headers, "X-Idempotency-Key": idemp_pago}
        )
        assert r_pago.status_code == 201, r_pago.text
        pago_data = r_pago.json()
        pago_id = pago_data["id"]
        assert pago_data["nueva_fecha_vencimiento"] == (hoy + timedelta(days=30)).isoformat()

        # 3. Cerrar Turno 1
        r_cerrar1 = await client.post(
            "/caja/turnos/cerrar",
            json={"efectivo_contado": 140000},  # 50k base + 90k pago
            headers=headers
        )
        assert r_cerrar1.status_code == 200, r_cerrar1.text

        # 4. Intentar anular pago SIN turno abierto -> Debe fallar con 400 NO_HAY_TURNO_ABIERTO (GW-RF-16 CA3)
        r_anular_sin_turno = await client.post(
            f"/caja/pagos-membresia/{pago_id}/anular",
            json={"motivo": "Anulación por error de cobro"},
            headers=headers
        )
        assert r_anular_sin_turno.status_code == 400, r_anular_sin_turno.text
        err = r_anular_sin_turno.json().get("error", {})
        assert err.get("codigo") == "NO_HAY_TURNO_ABIERTO"

        # 5. Abrir Turno 2 (turno actual donde entrará el reverso)
        r_abrir2 = await client.post(
            "/caja/turnos/abrir",
            json={"base_inicial": 100000},
            headers=headers
        )
        assert r_abrir2.status_code == 201, r_abrir2.text
        turno2_id = r_abrir2.json()["id"]

        # 6. Anular el pago de membresía ahora que Turno 2 está abierto
        r_anular = await client.post(
            f"/caja/pagos-membresia/{pago_id}/anular",
            json={"motivo": "Cliente solicitó devolución por error de digitación"},
            headers=headers
        )
        assert r_anular.status_code == 200, r_anular.text

        # 7. Verificar en BD que el vencimiento volvió exactamente a venc_inicial (recalculado del historial)
        # y NO a hoy (lo que daría si simplemente restara 30 días a hoy + 30)
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            q_m = text("SELECT fecha_vencimiento FROM platform.membresias WHERE id = :id")
            res_m = await session.execute(q_m, {"id": memb_id})
            fvenc_recalculada = res_m.scalar()
            assert fvenc_recalculada == venc_inicial

            # Verificar reverso contable en platform.devoluciones (GW-RF-16 CA3)
            q_dev = text("""
                SELECT turno_devolucion_id, turno_pago_original_id, pago_membresia_id, monto, tipo_medio_reembolso
                FROM platform.devoluciones
                WHERE pago_membresia_id = :pago_id
            """)
            res_dev = await session.execute(q_dev, {"pago_id": pago_id})
            dev = res_dev.mappings().first()
            assert dev is not None
            assert str(dev["turno_devolucion_id"]) == str(turno2_id)
            assert str(dev["turno_pago_original_id"]) == str(turno1_id)
            assert Decimal(str(dev["monto"])) == Decimal("90000")
            assert dev["tipo_medio_reembolso"] == "efectivo"

        # 8. Comprobar que en Turno 2 la devolución en efectivo resta del total esperado
        r_turno2 = await client.get("/caja/turnos/actual", headers=headers)
        assert r_turno2.status_code == 200, r_turno2.text
        t2_resumen = r_turno2.json()
        assert Decimal(str(t2_resumen["devoluciones_efectivo"])) == Decimal("90000")
        assert Decimal(str(t2_resumen["total_esperado_efectivo"])) == Decimal("10000")  # 100k base - 90k devolución

        # 9. Intentar anular nuevamente el mismo pago -> Debe rechazar con 400 PAGO_YA_ANULADO
        r_re_anular = await client.post(
            f"/caja/pagos-membresia/{pago_id}/anular",
            json={"motivo": "Reintento inválido"},
            headers=headers
        )
        assert r_re_anular.status_code == 400, r_re_anular.text
        err_re = r_re_anular.json().get("error", {})
        assert err_re.get("codigo") == "PAGO_YA_ANULADO"


@pytest.mark.asyncio
async def test_anular_pago_con_congelamiento_entre_medio():
    """
    Verifica el caso de prueba 3.10:
    Si hubo un congelamiento durante el período del pago que luego se anula,
    el recálculo desde el historial asegura que el vencimiento regresa al estado
    base real y no deja días gratis en el futuro.
    """
    gym_id = uuid.uuid4()
    jefe_id = uuid.uuid4()
    plan_id = uuid.uuid4()
    dep_id = uuid.uuid4()
    memb_id = uuid.uuid4()
    prefix = uuid.uuid4().hex[:6]

    hoy = today_local()
    venc_base = hoy - timedelta(days=5)
    inicio_memb = venc_base - timedelta(days=30)

    pwd_hash = hash_password("secreto123")

    async with async_session_maker() as session:
        async with session.begin():
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, dias_gracia_mora, tope_dias_congelamiento, activo)
                VALUES (:id, :nom, :sub, 3, 30, true)
            """), {"id": gym_id, "nom": f"Gym CongHist {prefix}", "sub": f"ch-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Cong', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_ch_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, :nom, 100000, 30, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id, "nom": f"Plan Cong {prefix}"})

            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :gym, :doc, 'Atleta Congelado', 'atleta_ch@test.com', true, now(), true)
            """), {"id": dep_id, "gym": gym_id, "doc": f"DOC-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.membresias (
                    id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento,
                    plan_precio_vendido, plan_duracion_dias_vendida, cancelada
                ) VALUES (
                    :id, :gym, :dep, :plan, :fini, :fvenc, 100000, 30, false
                )
            """), {
                "id": memb_id, "gym": gym_id, "dep": dep_id,
                "plan": plan_id, "fini": inicio_memb, "fvenc": venc_base
            })

    token = create_access_token(str(jefe_id), str(gym_id), "jefe")
    headers = {"Authorization": f"Bearer {token}", "X-Gimnasio-ID": str(gym_id)}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver/api/v1") as client:
        # Abrir turno
        r_abrir = await client.post("/caja/turnos/abrir", json={"base_inicial": 20000}, headers=headers)
        assert r_abrir.status_code == 201

        # Pagar 30 días hoy -> vence en hoy + 30
        r_p = await client.post(
            "/caja/pagos-membresia",
            json={"membresia_id": str(memb_id), "monto": 100000, "metodo": "efectivo", "tipo_medio": "efectivo", "dias_agregados": 30},
            headers={**headers, "X-Idempotency-Key": f"k-{uuid.uuid4().hex}"}
        )
        assert r_p.status_code == 201
        pago_id = r_p.json()["id"]

        # Insertar congelamiento que ocurrió durante este período (ej. 5 días entre hoy+2 y hoy+7)
        async with async_session_maker() as session:
            async with session.begin():
                await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
                await session.execute(text("""
                    INSERT INTO platform.congelamientos (gimnasio_id, membresia_id, fecha_inicio, fecha_fin, dias, registrado_por)
                    VALUES (:gym, :m, :fi, :ff, 5, :staff)
                """), {
                    "gym": gym_id, "m": memb_id,
                    "fi": hoy + timedelta(days=2), "ff": hoy + timedelta(days=7),
                    "staff": jefe_id
                })
                # El congelamiento extendió fecha_vencimiento a hoy + 35
                await session.execute(text("""
                    UPDATE platform.membresias SET fecha_vencimiento = :fv WHERE id = :id
                """), {"fv": hoy + timedelta(days=35), "id": memb_id})

        # Anular pago
        r_anular = await client.post(
            f"/caja/pagos-membresia/{pago_id}/anular",
            json={"motivo": "Anulación con congelamiento intermedio"},
            headers=headers
        )
        assert r_anular.status_code == 200

        # Verificar que el vencimiento volvió a venc_base (hace 5 días) y no a hoy + 5
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            q_res = text("SELECT fecha_vencimiento FROM platform.membresias WHERE id = :id")
            res_m = await session.execute(q_res, {"id": memb_id})
            fv_final = res_m.scalar()
            assert fv_final == venc_base

