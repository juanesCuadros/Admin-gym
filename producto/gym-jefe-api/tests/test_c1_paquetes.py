import pytest
import uuid
from datetime import date, timedelta
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.main import app
from app.modules.auth.service import AuthService


@pytest.mark.asyncio
async def test_c1_planes_grupales_paquetes():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        prefix = uuid.uuid4().hex[:6]
        gym_id = uuid.uuid4()
        jefe_id = uuid.uuid4()
        titular_id = uuid.uuid4()
        ben1_id = uuid.uuid4()
        ben2_id = uuid.uuid4()
        menor_id = uuid.uuid4()
        plan_id = uuid.uuid4()
        pwd_hash = hash_password("ClaveSegura123!")

        hoy = date.today()
        # Titular mayor de edad: 25 años
        fn_titular = hoy - timedelta(days=25 * 365 + 10)
        # Menor de edad: 16 años
        fn_menor = hoy - timedelta(days=16 * 365)

        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})

            # Tenant
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo, permitir_descuentos, tope_descuento_pct)
                VALUES (:id, :nom, :sub, true, true, 20.0)
            """), {"id": gym_id, "nom": f"Gym C1 Paq {prefix}", "sub": f"c1-paq-{prefix}"})

            # Staff Jefe
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Paquetes', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_paq_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            # Plan Familiar: cupo = 3 personas, precio = 150001, duración = 30 días
            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, 'Plan Familiar Trío', 150001, 30, 'familiar', 3, true)
            """), {"id": plan_id, "gym": gym_id})

            # Deportistas
            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, fecha_nacimiento, telefono, activo)
                VALUES
                (:t_id, :gym, :doc1, 'Titular Adulto', :m1, :fn_t, '3001112233', true),
                (:b1_id, :gym, :doc2, 'Beneficiario Dos', :m2, '2000-01-01', '3002223344', true),
                (:b2_id, :gym, :doc3, 'Beneficiario Tres', :m3, '2002-02-02', '3003334455', true),
                (:m_id, :gym, :doc4, 'Titular Menor', :m4, :fn_m, '3004445566', true)
            """), {
                "gym": gym_id,
                "t_id": titular_id, "doc1": f"DOC1-{prefix}", "m1": f"t_{prefix}@test.com", "fn_t": fn_titular,
                "b1_id": ben1_id, "doc2": f"DOC2-{prefix}", "m2": f"b1_{prefix}@test.com",
                "b2_id": ben2_id, "doc3": f"DOC3-{prefix}", "m3": f"b2_{prefix}@test.com",
                "m_id": menor_id, "doc4": f"DOC4-{prefix}", "m4": f"menor_{prefix}@test.com", "fn_m": fn_menor
            })

            await session.commit()

        tok_jefe = create_access_token(str(jefe_id), str(gym_id), "jefe")
        h_jefe = {"Authorization": f"Bearer {tok_jefe}"}

        # ---------------------------------------------------------------------
        # 1. Error 422 BENEFICIARIOS_INCOMPLETOS (requiere 3, se envían 2)
        # ---------------------------------------------------------------------
        r_inc = await client.post(
            "/api/v1/membresias/paquetes",
            json={
                "plan_id": str(plan_id),
                "titular_id": str(titular_id),
                "beneficiarios": [str(titular_id), str(ben1_id)]
            },
            headers=h_jefe
        )
        assert r_inc.status_code == 422
        err_inc = r_inc.json()["error"]
        assert err_inc["codigo"] == "BENEFICIARIOS_INCOMPLETOS"
        assert err_inc["detalles"]["requeridos"] == 3
        assert err_inc["detalles"]["recibidos"] == 2

        # ---------------------------------------------------------------------
        # 2. Error 422 TITULAR_NO_ES_BENEFICIARIO (titular no incluido en lista)
        # ---------------------------------------------------------------------
        r_no_ben = await client.post(
            "/api/v1/membresias/paquetes",
            json={
                "plan_id": str(plan_id),
                "titular_id": str(titular_id),
                "beneficiarios": [str(ben1_id), str(ben2_id), str(menor_id)]
            },
            headers=h_jefe
        )
        assert r_no_ben.status_code == 422
        assert r_no_ben.json()["error"]["codigo"] == "TITULAR_NO_ES_BENEFICIARIO"

        # ---------------------------------------------------------------------
        # 3. Error 409 BENEFICIARIO_DUPLICADO (mismo beneficiario repetido)
        # ---------------------------------------------------------------------
        r_dup = await client.post(
            "/api/v1/membresias/paquetes",
            json={
                "plan_id": str(plan_id),
                "titular_id": str(titular_id),
                "beneficiarios": [str(titular_id), str(ben1_id), str(ben1_id)]
            },
            headers=h_jefe
        )
        assert r_dup.status_code == 409
        assert r_dup.json()["error"]["codigo"] == "BENEFICIARIO_DUPLICADO"

        # ---------------------------------------------------------------------
        # 4. Error 422 TITULAR_MENOR_DE_EDAD
        # ---------------------------------------------------------------------
        r_menor = await client.post(
            "/api/v1/membresias/paquetes",
            json={
                "plan_id": str(plan_id),
                "titular_id": str(menor_id),
                "beneficiarios": [str(menor_id), str(ben1_id), str(ben2_id)]
            },
            headers=h_jefe
        )
        assert r_menor.status_code == 422
        assert r_menor.json()["error"]["codigo"] == "TITULAR_MENOR_DE_EDAD"

        # ---------------------------------------------------------------------
        # 5. Creación exitosa del paquete
        # ---------------------------------------------------------------------
        r_crear = await client.post(
            "/api/v1/membresias/paquetes",
            json={
                "plan_id": str(plan_id),
                "titular_id": str(titular_id),
                "beneficiarios": [str(titular_id), str(ben1_id), str(ben2_id)]
            },
            headers=h_jefe
        )
        assert r_crear.status_code == 201
        paq_data = r_crear.json()
        paquete_id = paq_data["paquete_id"]
        membresias = paq_data["membresias"]
        assert len(membresias) == 3

        # Validar división de precio en enteros con sobrante al titular (150001 / 3 = 50000 con sobrante 1)
        m_titular = next(m for m in membresias if m["deportista_id"] == str(titular_id))
        m_otros = [m for m in membresias if m["deportista_id"] != str(titular_id)]
        assert Decimal(str(m_titular["precio_asignado"])) == Decimal("50001")
        for mo in m_otros:
            assert Decimal(str(mo["precio_asignado"])) == Decimal("50000")

        # ---------------------------------------------------------------------
        # 6. Consultar detalle del paquete GET /membresias/paquetes/{id}
        # ---------------------------------------------------------------------
        r_get = await client.get(f"/api/v1/membresias/paquetes/{paquete_id}", headers=h_jefe)
        assert r_get.status_code == 200
        get_data = r_get.json()
        assert get_data["id"] == paquete_id
        assert get_data["plan_nombre"] == "Plan Familiar Trío"
        assert get_data["titular"]["nombre"] == "Titular Adulto"
        assert len(get_data["membresias"]) == 3

        # ---------------------------------------------------------------------
        # 7. Cobro unificado en Caja POST /caja/pagos-membresia con paquete_id
        # ---------------------------------------------------------------------
        # Abrir turno de caja
        r_abrir = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 50000}, headers=h_jefe)
        assert r_abrir.status_code == 201

        # Pago de paquete: cubre las 3 membresías y extiende su vigencia por 30 días
        r_pago = await client.post(
            "/api/v1/caja/pagos-membresia",
            json={
                "paquete_id": paquete_id,
                "monto": 150001,
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "dias_agregados": 30
            },
            headers={**h_jefe, "X-Idempotency-Key": f"key-paq-pago-{prefix}"}
        )
        assert r_pago.status_code == 201
        pago_res = r_pago.json()
        pago_id = pago_res["id"]
        assert pago_res["paquete_id"] == paquete_id
        assert pago_res["membresia_id"] is None
        assert Decimal(str(pago_res["monto"])) == Decimal("150001")

        # Verificar que las 3 membresías extendieron su fecha de vencimiento
        r_get_after = await client.get(f"/api/v1/membresias/paquetes/{paquete_id}", headers=h_jefe)
        for m in r_get_after.json()["membresias"]:
            f_ini = date.fromisoformat(m["fecha_inicio"])
            f_venc = date.fromisoformat(m["fecha_vencimiento"])
            assert (f_venc - f_ini).days == 60 # 30 iniciales + 30 agregados

        # ---------------------------------------------------------------------
        # 8. Anulación del pago de paquete revierte las 3 membresías (GW-RF-52)
        # ---------------------------------------------------------------------
        r_anular = await client.post(
            f"/api/v1/caja/pagos-membresia/{pago_id}/anular",
            json={"motivo": "Error de cobro de paquete familiar"},
            headers=h_jefe
        )
        assert r_anular.status_code == 200

        # Verificar que el vencimiento volvió a los 30 días base
        r_get_revert = await client.get(f"/api/v1/membresias/paquetes/{paquete_id}", headers=h_jefe)
        for m in r_get_revert.json()["membresias"]:
            f_ini = date.fromisoformat(m["fecha_inicio"])
            f_venc = date.fromisoformat(m["fecha_vencimiento"])
            assert (f_venc - f_ini).days == 30
