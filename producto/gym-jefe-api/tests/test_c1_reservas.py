import pytest
import uuid
from datetime import date, datetime, timedelta, timezone
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.core.timezone import LOCAL_TZ, now_local, now_utc
from app.main import app
from app.modules.auth.service import AuthService


@pytest.mark.asyncio
async def test_c1_reservas_ventana_vencimiento_y_cancelacion():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        prefix = uuid.uuid4().hex[:6]
        gym_id = uuid.uuid4()
        jefe_id = uuid.uuid4()
        dep_id = uuid.uuid4()
        plan_id = uuid.uuid4()
        clase_lejana_id = uuid.uuid4()
        clase_cercana_id = uuid.uuid4()
        clase_inminente_id = uuid.uuid4()
        clase_cancelable_id = uuid.uuid4()
        pwd_hash = hash_password("ClaveSegura123!")

        hoy = date.today()
        now_dt = now_utc()

        # Clase a 10 días (fuera de ventana de 7 días)
        dt_lejana = now_dt + timedelta(days=10)
        # Clase a 3 días (dentro de ventana)
        dt_cercana = now_dt + timedelta(days=3)
        # Clase inminente en 1 hora (límite cancelar = 2 horas)
        dt_inminente = now_dt + timedelta(hours=1, minutes=10)
        # Clase cancelable en 5 horas
        dt_cancelable = now_dt + timedelta(hours=5)

        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})

            # Tenant con ventana_reserva_dias = 7 y limite_cancelar_reserva_horas = 2
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo, ventana_reserva_dias, limite_cancelar_reserva_horas)
                VALUES (:id, :nom, :sub, true, 7, 2)
            """), {"id": gym_id, "nom": f"Gym C1 Reservas {prefix}", "sub": f"c1-res-{prefix}"})

            # Staff
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Reservas', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_res_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            # Deportista
            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, fecha_nacimiento, activo)
                VALUES (:id, :gym, :doc, 'Atleta Reservas', :mail, '1998-08-08', true)
            """), {"id": dep_id, "gym": gym_id, "doc": f"DOC-{prefix}", "mail": f"dep_{prefix}@test.com"})

            # Plan y Membresía que vence en 2 días (antes de la clase de 3 días)
            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, 'Plan Corto', 50000, 30, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id})

            await session.execute(text("""
                INSERT INTO platform.membresias (
                    id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada
                ) VALUES (
                    gen_random_uuid(), :gym, :dep, :plan, :hoy, :venc, false
                )
            """), {"gym": gym_id, "dep": dep_id, "plan": plan_id, "hoy": hoy - timedelta(days=28), "venc": hoy + timedelta(days=2)})

            # Clases programadas (cumpliendo constraint clase_profesor)
            await session.execute(text("""
                INSERT INTO platform.clases (id, gimnasio_id, nombre, cupo, fecha_hora, estado, profesor_externo)
                VALUES
                (:c1, :gym, 'Spinning Lejano', 15, :dt1, 'programada', 'Profesor Externo'),
                (:c2, :gym, 'Crossfit Cercano', 15, :dt2, 'programada', 'Profesor Externo'),
                (:c3, :gym, 'Yoga Inminente', 15, :dt3, 'programada', 'Profesor Externo'),
                (:c4, :gym, 'Pilates Cancelable', 15, :dt4, 'programada', 'Profesor Externo')
            """), {
                "gym": gym_id,
                "c1": clase_lejana_id, "dt1": dt_lejana,
                "c2": clase_cercana_id, "dt2": dt_cercana,
                "c3": clase_inminente_id, "dt3": dt_inminente,
                "c4": clase_cancelable_id, "dt4": dt_cancelable
            })

            await session.commit()

        tok_jefe = create_access_token(str(jefe_id), str(gym_id), "jefe")
        h_jefe = {"Authorization": f"Bearer {tok_jefe}"}

        # ---------------------------------------------------------------------
        # 1. Error 422 FUERA_DE_VENTANA_RESERVA (GW-RF-33 CA3: clase a 10 días, ventana = 7)
        # ---------------------------------------------------------------------
        r_ventana = await client.post(
            f"/api/v1/clases/{clase_lejana_id}/reservas",
            json={"deportista_id": str(dep_id)},
            headers=h_jefe
        )
        assert r_ventana.status_code == 422
        err_v = r_ventana.json()["error"]
        assert err_v["codigo"] == "FUERA_DE_VENTANA_RESERVA"
        assert err_v["detalles"]["ventana_dias"] == 7

        # ---------------------------------------------------------------------
        # 2. Error 422 CLASE_POSTERIOR_A_VENCIMIENTO (GW-RF-33 CA2: clase en 3 días, membresía vence en 2)
        # ---------------------------------------------------------------------
        r_post = await client.post(
            f"/api/v1/clases/{clase_cercana_id}/reservas",
            json={"deportista_id": str(dep_id)},
            headers=h_jefe
        )
        assert r_post.status_code == 422
        err_post = r_post.json()["error"]
        assert err_post["codigo"] == "CLASE_POSTERIOR_A_VENCIMIENTO"

        # ---------------------------------------------------------------------
        # 3. Extender la membresía para permitir reservas futuras
        # ---------------------------------------------------------------------
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                UPDATE platform.membresias
                SET fecha_vencimiento = :nueva_venc
                WHERE gimnasio_id = :gym AND deportista_id = :dep
            """), {"gym": gym_id, "dep": dep_id, "nueva_venc": hoy + timedelta(days=30)})
            await session.commit()

        # Ahora sí permite reservar la clase cercana
        r_res_ok = await client.post(
            f"/api/v1/clases/{clase_cercana_id}/reservas",
            json={"deportista_id": str(dep_id)},
            headers=h_jefe
        )
        assert r_res_ok.status_code == 201
        assert r_res_ok.json()["estado"] == "reservada"

        # ---------------------------------------------------------------------
        # 4. Error 422 LIMITE_CANCELACION_SUPERADO (GW-RF-33 CA3: clase inminente en 1h, límite = 2h)
        # ---------------------------------------------------------------------
        # Reservar clase inminente
        r_res_inm = await client.post(
            f"/api/v1/clases/{clase_inminente_id}/reservas",
            json={"deportista_id": str(dep_id)},
            headers=h_jefe
        )
        assert r_res_inm.status_code == 201
        reserva_inm_id = r_res_inm.json()["id"]

        # Intento de cancelar a menos de 2 horas de la clase -> 422
        r_canc_inm = await client.delete(
            f"/api/v1/clases/{clase_inminente_id}/reservas/{reserva_inm_id}",
            headers=h_jefe
        )
        assert r_canc_inm.status_code == 422
        err_canc = r_canc_inm.json()["error"]
        assert err_canc["codigo"] == "LIMITE_CANCELACION_SUPERADO"
        assert err_canc["detalles"]["limite_horas"] == 2

        # ---------------------------------------------------------------------
        # 5. Cancelación exitosa dentro del límite permitido (clase en 5 horas > 2 horas)
        # ---------------------------------------------------------------------
        r_res_canc = await client.post(
            f"/api/v1/clases/{clase_cancelable_id}/reservas",
            json={"deportista_id": str(dep_id)},
            headers=h_jefe
        )
        assert r_res_canc.status_code == 201
        reserva_canc_id = r_res_canc.json()["id"]

        r_canc_ok = await client.delete(
            f"/api/v1/clases/{clase_cancelable_id}/reservas/{reserva_canc_id}",
            headers=h_jefe
        )
        assert r_canc_ok.status_code == 200
        assert r_canc_ok.json()["estado"] == "cancelada"
