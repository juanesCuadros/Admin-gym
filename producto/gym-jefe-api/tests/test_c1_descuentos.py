import pytest
import uuid
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.main import app
from app.modules.auth.service import AuthService


@pytest.mark.asyncio
async def test_c1_descuentos_pos_y_pagos():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        prefix = uuid.uuid4().hex[:6]
        gym_id = uuid.uuid4()
        jefe_id = uuid.uuid4()
        recep_id = uuid.uuid4()
        prod_id = uuid.uuid4()
        dep_id = uuid.uuid4()
        plan_id = uuid.uuid4()
        memb_id = uuid.uuid4()
        pwd_hash = hash_password("ClaveSegura123!")

        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            
            # Tenant con descuentos habilitados y tope del 20%
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo, permitir_descuentos, tope_descuento_pct)
                VALUES (:id, :nom, :sub, true, true, 20.0)
            """), {"id": gym_id, "nom": f"Gym C1 Desc {prefix}", "sub": f"c1-desc-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Descuentos', true)
            """), {"id": jefe_id, "gym": gym_id, "mail": f"jefe_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recepcionista Sin Permiso', true)
            """), {"id": recep_id, "gym": gym_id, "mail": f"recep_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)

            # Producto en catálogo: precio lista 100,000 COP, stock 10
            await session.execute(text("""
                INSERT INTO platform.productos (id, gimnasio_id, nombre, precio, stock, activo)
                VALUES (:id, :gym, 'Proteína Whey 2lb', 100000, 10, true)
            """), {"id": prod_id, "gym": gym_id})

            # Deportista y Plan
            await session.execute(text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, activo)
                VALUES (:id, :gym, :doc, 'Cliente Descuentos', :mail, true)
            """), {"id": dep_id, "gym": gym_id, "doc": f"DOC-{prefix}", "mail": f"dep_{prefix}@test.com"})

            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo)
                VALUES (:id, :gym, 'Plan Mensual 80k', 80000, 30, 'individual', 1, true)
            """), {"id": plan_id, "gym": gym_id})

            # Membresía inicial
            await session.execute(text("""
                INSERT INTO platform.membresias (
                    id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento,
                    cancelada, plan_precio_vendido, plan_duracion_dias_vendida
                ) VALUES (
                    :id, :gym, :dep, :plan, CURRENT_DATE, CURRENT_DATE + 30,
                    false, 80000, 30
                )
            """), {"id": memb_id, "gym": gym_id, "dep": dep_id, "plan": plan_id})

            await session.commit()

        tok_jefe = create_access_token(str(jefe_id), str(gym_id), "jefe")
        tok_recep = create_access_token(str(recep_id), str(gym_id), "recepcionista")
        h_jefe = {"Authorization": f"Bearer {tok_jefe}"}
        h_recep = {"Authorization": f"Bearer {tok_recep}"}

        # Abrir turno con el Jefe
        r_abrir = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 50000}, headers=h_jefe)
        assert r_abrir.status_code == 201

        # ---------------------------------------------------------------------
        # 1. Error 422 MOTIVO_DESCUENTO_REQUERIDO (precio_cobrado menor sin motivo)
        # ---------------------------------------------------------------------
        r_v1 = await client.post(
            "/api/v1/caja/ventas",
            json={
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "items": [
                    {
                        "tipo": "producto",
                        "producto_id": str(prod_id),
                        "descripcion": "Proteína Whey",
                        "cantidad": 1,
                        "precio_cobrado": 90000,
                        "motivo_descuento": "" # Vacío o None
                    }
                ]
            },
            headers={**h_jefe, "X-Idempotency-Key": f"key-desc-1-{prefix}"}
        )
        assert r_v1.status_code == 422
        assert r_v1.json()["error"]["codigo"] == "MOTIVO_DESCUENTO_REQUERIDO"

        # ---------------------------------------------------------------------
        # 2. Error 422 DESCUENTO_SUPERA_TOPE (precio_cobrado 70,000 = 30% desc, tope = 20%)
        # ---------------------------------------------------------------------
        r_v2 = await client.post(
            "/api/v1/caja/ventas",
            json={
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "items": [
                    {
                        "tipo": "producto",
                        "producto_id": str(prod_id),
                        "descripcion": "Proteína Whey",
                        "cantidad": 1,
                        "precio_cobrado": 70000,
                        "motivo_descuento": "Campaña aniversario"
                    }
                ]
            },
            headers={**h_jefe, "X-Idempotency-Key": f"key-desc-2-{prefix}"}
        )
        assert r_v2.status_code == 422
        err2 = r_v2.json()["error"]
        assert err2["codigo"] == "DESCUENTO_SUPERA_TOPE"
        assert "tope_pct" in err2["detalles"]

        # ---------------------------------------------------------------------
        # 3. Venta POS exitosa con descuento respetando tope (10% descuento: 100k -> 90k)
        # ---------------------------------------------------------------------
        r_v3 = await client.post(
            "/api/v1/caja/ventas",
            json={
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "valor_recibido": 100000,
                "items": [
                    {
                        "tipo": "producto",
                        "producto_id": str(prod_id),
                        "descripcion": "Proteína Whey",
                        "cantidad": 1,
                        "precio_cobrado": 90000,
                        "motivo_descuento": "Descuento por fidelidad cliente"
                    }
                ]
            },
            headers={**h_jefe, "X-Idempotency-Key": f"key-desc-3-{prefix}"}
        )
        assert r_v3.status_code == 201
        v3_data = r_v3.json()
        assert Decimal(str(v3_data["total"])) == Decimal("90000")
        assert Decimal(str(v3_data["cambio_devuelto"])) == Decimal("10000")
        item_resp = v3_data["items"][0]
        assert Decimal(str(item_resp["precio_lista"])) == Decimal("100000")
        assert Decimal(str(item_resp["precio_cobrado"])) == Decimal("90000")
        assert Decimal(str(item_resp["descuento_pct"])) == Decimal("10.0")
        assert item_resp["motivo_descuento"] == "Descuento por fidelidad cliente"

        # ---------------------------------------------------------------------
        # 4. Pago de membresía con descuento (80k lista -> 72k cobrado, 10% desc)
        # ---------------------------------------------------------------------
        r_pago = await client.post(
            "/api/v1/caja/pagos-membresia",
            json={
                "membresia_id": str(memb_id),
                "monto": 72000,
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "dias_agregados": 30,
                "precio_cobrado": 72000,
                "motivo_descuento": "Renovación anticipada promo"
            },
            headers={**h_jefe, "X-Idempotency-Key": f"key-desc-pago-{prefix}"}
        )
        assert r_pago.status_code == 201
        pago_data = r_pago.json()
        assert Decimal(str(pago_data["monto"])) == Decimal("72000")
        assert Decimal(str(pago_data["precio_lista"])) == Decimal("80000")
        assert Decimal(str(pago_data["precio_cobrado"])) == Decimal("72000")
        assert Decimal(str(pago_data["descuento_pct"])) == Decimal("10.0")
        assert pago_data["motivo_descuento"] == "Renovación anticipada promo"

        # ---------------------------------------------------------------------
        # 5. Deshabilitar descuentos en tenant -> 403 DESCUENTOS_DESHABILITADOS
        # ---------------------------------------------------------------------
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                UPDATE platform.tenant SET permitir_descuentos = false WHERE id = :gym_id
            """), {"gym_id": gym_id})
            await session.commit()

        r_v_deshab = await client.post(
            "/api/v1/caja/ventas",
            json={
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "items": [
                    {
                        "tipo": "producto",
                        "producto_id": str(prod_id),
                        "descripcion": "Proteína Whey",
                        "cantidad": 1,
                        "precio_cobrado": 90000,
                        "motivo_descuento": "Intento con descuento deshabilitado"
                    }
                ]
            },
            headers={**h_jefe, "X-Idempotency-Key": f"key-desc-deshab-{prefix}"}
        )
        assert r_v_deshab.status_code == 403
        assert r_v_deshab.json()["error"]["codigo"] == "DESCUENTOS_DESHABILITADOS"

        # ---------------------------------------------------------------------
        # 6. Reactivar descuentos pero probar staff recepcionista sin permiso -> 403 SIN_PERMISO_DESCUENTO
        # ---------------------------------------------------------------------
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                UPDATE platform.tenant SET permitir_descuentos = true WHERE id = :gym_id
            """), {"gym_id": gym_id})
            await session.commit()

        # Cerrar turno del jefe y abrir turno para recepcionista
        r_cerrar = await client.post("/api/v1/caja/turnos/cerrar", json={"efectivo_contado": 212000}, headers=h_jefe)
        assert r_cerrar.status_code == 200

        r_abrir_recep = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 20000}, headers=h_recep)
        assert r_abrir_recep.status_code == 201

        r_v_sin_perm = await client.post(
            "/api/v1/caja/ventas",
            json={
                "metodo": "efectivo",
                "tipo_medio": "efectivo",
                "items": [
                    {
                        "tipo": "producto",
                        "producto_id": str(prod_id),
                        "descripcion": "Proteína Whey",
                        "cantidad": 1,
                        "precio_cobrado": 95000,
                        "motivo_descuento": "Descuento recepcionista"
                    }
                ]
            },
            headers={**h_recep, "X-Idempotency-Key": f"key-desc-sinperm-{prefix}"}
        )
        assert r_v_sin_perm.status_code == 403
        assert r_v_sin_perm.json()["error"]["codigo"] == "SIN_PERMISO_DESCUENTO"
