import sys
sys.path.insert(0, ".")
import asyncio
from decimal import Decimal
import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.main import app


async def run_modulo_8_full_test_suite():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. SETUP DE TENANTS Y STAFF (Gym A y Gym B)
        prefix = uuid.uuid4().hex[:6]
        gym_a_id = uuid.uuid4()
        gym_b_id = uuid.uuid4()
        staff_jefe_a_id = uuid.uuid4()
        staff_coach_a_id = uuid.uuid4()
        staff_recep_a_id = uuid.uuid4()
        staff_jefe_b_id = uuid.uuid4()

        pwd_hash = hash_password("Password123!")

        async with async_session_maker() as session:
            # Tenant A
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id_a, :nom_a, :sub_a, true)
            """), {"id_a": gym_a_id, "nom_a": f"Gym Inv A {prefix}", "sub_a": f"inv-a-{prefix}"})

            # Staff Gym A
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Inv A', true)
            """), {"id": staff_jefe_a_id, "gym": gym_a_id, "mail": f"jefe_a_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'entrenador', :mail, :pwd, 'Coach Inv A', true)
            """), {"id": staff_coach_a_id, "gym": gym_a_id, "mail": f"coach_a_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recep Inv A', true)
            """), {"id": staff_recep_a_id, "gym": gym_a_id, "mail": f"recep_a_{prefix}@test.com", "pwd": pwd_hash})

            # Sembrar permisos canónicos para Gym A
            from app.modules.auth.service import AuthService
            await AuthService._seed_permisos_en_transaccion(session, gym_a_id)

            # Tenant B y Staff Gym B
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id_b, :nom_b, :sub_b, true)
            """), {"id_b": gym_b_id, "nom_b": f"Gym Inv B {prefix}", "sub_b": f"inv-b-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Inv B', true)
            """), {"id": staff_jefe_b_id, "gym": gym_b_id, "mail": f"jefe_b_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_b_id)
            await session.commit()

        # Generar Tokens JWT
        token_jefe_a = create_access_token(subject=str(staff_jefe_a_id), gym_id=str(gym_a_id), role="jefe")
        token_coach_a = create_access_token(subject=str(staff_coach_a_id), gym_id=str(gym_a_id), role="entrenador")
        token_recep_a = create_access_token(subject=str(staff_recep_a_id), gym_id=str(gym_a_id), role="recepcionista")
        token_jefe_b = create_access_token(subject=str(staff_jefe_b_id), gym_id=str(gym_b_id), role="jefe")

        headers_jefe_a = {"Authorization": f"Bearer {token_jefe_a}"}
        headers_coach_a = {"Authorization": f"Bearer {token_coach_a}"}
        headers_recep_a = {"Authorization": f"Bearer {token_recep_a}"}
        headers_jefe_b = {"Authorization": f"Bearer {token_jefe_b}"}

        print("--- [1/7] TEST CREACIÓN DE PRODUCTO CON STOCK INICIAL Y UNICIDAD ---")
        # Gym A crea producto con stock inicial de 20
        payload_prod_a = {
            "nombre": "Proteína Whey Vainilla 2lb",
            "precio": 140000.0,
            "stock_inicial": 20,
            "activo": True
        }
        res = await client.post("/api/v1/inventario/productos", json=payload_prod_a, headers=headers_jefe_a)
        assert res.status_code == 201, f"Error creando producto: {res.text}"
        data_prod_a = res.json()
        prod_a_id = data_prod_a["id"]
        assert data_prod_a["nombre"] == "Proteína Whey Vainilla 2lb"
        assert data_prod_a["stock"] == 20
        assert data_prod_a["activo"] is True
        print(f"OK: Producto A creado con ID {prod_a_id} y stock 20")

        # Verificar que en el Kardex se asentó el movimiento inicial
        res_kardex_init = await client.get(f"/api/v1/inventario/productos/{prod_a_id}/kardex", headers=headers_jefe_a)
        assert res_kardex_init.status_code == 200
        kardex_data = res_kardex_init.json()
        assert kardex_data["total"] == 1
        assert kardex_data["items"][0]["tipo"] == "entrada"
        assert kardex_data["items"][0]["cantidad"] == 20
        assert kardex_data["items"][0]["motivo"] == "Inventario inicial"
        print("OK: Movimiento 'Inventario inicial' verificado en Kardex")

        # Intentar duplicar nombre en Gym A -> 409 Conflict
        res_dup = await client.post("/api/v1/inventario/productos", json=payload_prod_a, headers=headers_jefe_a)
        assert res_dup.status_code == 409
        assert res_dup.json()["error"]["codigo"] == "PRODUCTO_YA_EXISTE"
        print("OK: Colisión de nombre duplicado en mismo tenant prevenida (409 Conflict)")

        # Gym B crea producto con el MISMO NOMBRE sin colisión -> 201 Created
        payload_prod_b = {
            "nombre": "Proteína Whey Vainilla 2lb",
            "precio": 155000.0,
            "stock_inicial": 10,
            "activo": True
        }
        res_b = await client.post("/api/v1/inventario/productos", json=payload_prod_b, headers=headers_jefe_b)
        assert res_b.status_code == 201
        prod_b_id = res_b.json()["id"]
        assert prod_b_id != prod_a_id
        print("OK: Mismo nombre de producto permitido en tenant distinto (aislamiento tenant_isolation)")

        print("\n--- [2/7] TEST AISLAMIENTO CROSS-TENANT ESTRICTO ---")
        # Gym B intenta consultar producto de Gym A -> 404
        r = await client.get(f"/api/v1/inventario/productos/{prod_a_id}", headers=headers_jefe_b)
        assert r.status_code == 404
        assert r.json()["error"]["codigo"] == "PRODUCTO_NO_ENCONTRADO"

        # Gym B intenta actualizar producto de Gym A -> 404
        r = await client.put(f"/api/v1/inventario/productos/{prod_a_id}", json={"nombre": "Hack", "precio": 10.0, "version": 1}, headers=headers_jefe_b)
        assert r.status_code == 404

        # Gym B intenta cambiar estado de producto de Gym A -> 404
        r = await client.patch(f"/api/v1/inventario/productos/{prod_a_id}/estado", json={"activo": False}, headers=headers_jefe_b)
        assert r.status_code == 404

        # Gym B intenta registrar entrada sobre producto de Gym A -> 404
        r = await client.post(f"/api/v1/inventario/productos/{prod_a_id}/entrada", json={"cantidad": 10}, headers=headers_jefe_b)
        assert r.status_code == 404

        # Gym B intenta registrar ajuste sobre producto de Gym A -> 404
        r = await client.post(f"/api/v1/inventario/productos/{prod_a_id}/ajuste", json={"cantidad": -5, "motivo": "Ajuste ilícito cross tenant"}, headers=headers_jefe_b)
        assert r.status_code == 404

        # Gym B intenta consultar kardex de producto de Gym A -> 404
        r = await client.get(f"/api/v1/inventario/productos/{prod_a_id}/kardex", headers=headers_jefe_b)
        assert r.status_code == 404

        # Gym B lista productos -> Solo ve su propio producto, nunca el de Gym A
        r = await client.get("/api/v1/inventario/productos", headers=headers_jefe_b)
        assert r.status_code == 200
        items_b = r.json()["items"]
        assert len(items_b) == 1
        assert items_b[0]["id"] == prod_b_id
        print("OK: Todas las operaciones cross-tenant bloqueadas con 404 Not Found")

        print("\n--- [3/7] TEST ENTRADA DE MERCANCÍA (RF-37) ---")
        # Gym A ingresa 15 unidades de mercancía con motivo de factura
        res_entrada = await client.post(
            f"/api/v1/inventario/productos/{prod_a_id}/entrada",
            json={"cantidad": 15, "motivo": "Factura Proveedor #987"},
            headers=headers_jefe_a
        )
        assert res_entrada.status_code == 200
        data_ent = res_entrada.json()
        assert data_ent["tipo"] == "entrada"
        assert data_ent["cantidad"] == 15
        assert data_ent["motivo"] == "Factura Proveedor #987"

        # Verificar stock actualizado a 35 (20 iniciales + 15 de entrada)
        res_prod = await client.get(f"/api/v1/inventario/productos/{prod_a_id}", headers=headers_jefe_a)
        assert res_prod.status_code == 200
        assert res_prod.json()["stock"] == 35
        print("OK: Entrada de stock incrementó stock correctamente a 35")

        print("\n--- [4/7] TEST AJUSTE MANUAL DE STOCK CON AUDITORÍA ESTRICTA (RF-37) ---")
        # 1. Cantidad 0 rechazada por validación Pydantic -> 422
        r_cero = await client.post(
            f"/api/v1/inventario/productos/{prod_a_id}/ajuste",
            json={"cantidad": 0, "motivo": "Ajuste inválido con cantidad cero"},
            headers=headers_jefe_a
        )
        assert r_cero.status_code == 422

        # 2. Motivo menor a 10 caracteres rechazado -> 422
        r_corto = await client.post(
            f"/api/v1/inventario/productos/{prod_a_id}/ajuste",
            json={"cantidad": -2, "motivo": "Corto"},
            headers=headers_jefe_a
        )
        assert r_corto.status_code == 422

        # 3. Intentar reducción que dejaría stock negativo (35 - 40 = -5) -> 400 Bad Request
        r_neg = await client.post(
            f"/api/v1/inventario/productos/{prod_a_id}/ajuste",
            json={"cantidad": -40, "motivo": "Merma por rotura de lote completo"},
            headers=headers_jefe_a
        )
        assert r_neg.status_code == 400
        assert r_neg.json()["error"]["codigo"] == "STOCK_INSUFICIENTE"
        print("OK: Restricción de no vender ni ajustar por debajo de cero validada (400 Bad Request)")

        # 4. Ajuste válido: reducción de 5 unidades por merma
        res_ajuste = await client.post(
            f"/api/v1/inventario/productos/{prod_a_id}/ajuste",
            json={"cantidad": -5, "motivo": "Merma por rotura de empaque en bodega"},
            headers=headers_jefe_a
        )
        assert res_ajuste.status_code == 200
        data_aj = res_ajuste.json()
        assert data_aj["tipo"] == "ajuste"
        assert data_aj["cantidad"] == -5

        # Stock debe ser ahora 30 (35 - 5)
        res_prod = await client.get(f"/api/v1/inventario/productos/{prod_a_id}", headers=headers_jefe_a)
        assert res_prod.json()["stock"] == 30
        print("OK: Ajuste manual redujo stock a 30")

        # 5. VERIFICACIÓN DE AUDITORÍA HASH-CHAIN EN platform.auditoria_gym
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            audit_query = text("""
                SELECT accion, entidad, entidad_id, detalle, hash_actual
                FROM platform.auditoria_gym
                WHERE gimnasio_id = :gym_id AND accion = 'AJUSTE_STOCK_INVENTARIO'
                ORDER BY id DESC LIMIT 1
            """)
            audit_row = (await session.execute(audit_query, {"gym_id": gym_a_id})).mappings().first()
            assert audit_row is not None, "No se encontró registro de auditoría para el ajuste de stock"
            assert audit_row["accion"] == "AJUSTE_STOCK_INVENTARIO"
            assert audit_row["entidad"] == "productos"
            assert audit_row["entidad_id"] == str(prod_a_id)
            detalle = audit_row["detalle"]
            assert detalle["cantidad_ajustada"] == -5
            assert detalle["nuevo_stock"] == 30
            assert detalle["stock_anterior"] == 35
            assert "rotura de empaque" in detalle["motivo"]
            print("OK: Registro inmutable en platform.auditoria_gym verificado exitosamente")

        print("\n--- [5/7] TEST KARDEX COMPLETO Y FILTRADO GENERAL ---")
        # Kardex de producto A debe tener 3 movimientos (inicial: +20, entrada: +15, ajuste: -5)
        res_k_prod = await client.get(f"/api/v1/inventario/productos/{prod_a_id}/kardex", headers=headers_jefe_a)
        assert res_k_prod.status_code == 200
        movs = res_k_prod.json()["items"]
        assert len(movs) == 3
        assert [m["tipo"] for m in movs] == ["ajuste", "entrada", "entrada"]

        # Kardex general del gimnasio con filtro de tipo
        res_k_ajustes = await client.get("/api/v1/inventario/kardex?tipo=ajuste", headers=headers_jefe_a)
        assert res_k_ajustes.status_code == 200
        items_aj = res_k_ajustes.json()["items"]
        assert len(items_aj) == 1
        assert items_aj[0]["tipo"] == "ajuste"
        assert items_aj[0]["cantidad"] == -5
        print("OK: Kardex general y filtrado por tipo verificados")

        print("\n--- [6/7] TEST CONTROL DE ACCESO BASADO EN ROLES (RBAC) ---")
        # Recepcionista tiene puede_leer=True, pero puede_crear=False y puede_editar=False por defecto
        # 1. Recepcionista puede listar productos
        r_recep_list = await client.get("/api/v1/inventario/productos", headers=headers_recep_a)
        assert r_recep_list.status_code == 200
        print("OK: Recepcionista puede listar productos (puede_leer=True)")

        # 2. Recepcionista no puede crear productos -> 403 Forbidden
        r_recep_create = await client.post(
            "/api/v1/inventario/productos",
            json={"nombre": "Creatina Monohidrato", "precio": 90000.0},
            headers=headers_recep_a
        )
        assert r_recep_create.status_code == 403
        print("OK: Recepcionista bloqueado al crear producto (403 Forbidden)")

        # 3. Recepcionista no puede registrar ajustes -> 403 Forbidden
        r_recep_aj = await client.post(
            f"/api/v1/inventario/productos/{prod_a_id}/ajuste",
            json={"cantidad": 1, "motivo": "Intento de ajuste por recepcionista"},
            headers=headers_recep_a
        )
        assert r_recep_aj.status_code == 403
        print("OK: Recepcionista bloqueado al registrar ajuste (403 Forbidden)")

        # 4. Entrenador tiene todo en False en inventario -> 403 Forbidden al listar
        r_coach_list = await client.get("/api/v1/inventario/productos", headers=headers_coach_a)
        assert r_coach_list.status_code == 403
        print("OK: Entrenador bloqueado completamente en inventario (403 Forbidden)")

        print("\n--- [7/7] TEST CONTROL DE CONCURRENCIA OPTIMISTA (VERSION) Y ACTUALIZACIÓN ---")
        # 1. Obtener versión actual del producto
        res_cur = await client.get(f"/api/v1/inventario/productos/{prod_a_id}", headers=headers_jefe_a)
        assert res_cur.status_code == 200
        cur_version = res_cur.json()["version"]

        # 2. Intento de actualizar con versión obsoleta -> 409 CONFLICTO_CONCURRENCIA
        res_stale = await client.put(
            f"/api/v1/inventario/productos/{prod_a_id}",
            json={"nombre": "Proteína Intento Desactualizado", "precio": 150000.0, "version": cur_version + 99},
            headers=headers_jefe_a
        )
        assert res_stale.status_code == 409
        assert res_stale.json()["error"]["codigo"] == "CONFLICTO_CONCURRENCIA"
        print("OK: Actualización con versión obsoleta rechazada (409 CONFLICTO_CONCURRENCIA)")

        # 3. Actualización válida con versión exacta
        res_up = await client.put(
            f"/api/v1/inventario/productos/{prod_a_id}",
            json={"nombre": "Proteína Whey Vainilla Aislada 2lb", "precio": 148000.0, "version": cur_version},
            headers=headers_jefe_a
        )
        assert res_up.status_code == 200
        up_data = res_up.json()
        assert up_data["nombre"] == "Proteína Whey Vainilla Aislada 2lb"
        assert Decimal(str(up_data["precio"])) == Decimal("148000.00")
        assert up_data["version"] == cur_version + 1
        assert up_data["stock"] == 30  # El stock debe permanecer inmutable en PUT
        print(f"OK: Actualización exitosa con version={cur_version} -> nueva version={up_data['version']}")

        # 4. Desactivación lógica
        res_desc = await client.patch(
            f"/api/v1/inventario/productos/{prod_a_id}/estado",
            json={"activo": False},
            headers=headers_jefe_a
        )
        assert res_desc.status_code == 200
        assert res_desc.json()["activo"] is False
        print("OK: Producto desactivado lógicamente preservando trazabilidad")

        print("\n" + "="*70)
        print(">>> TODOS LOS TESTS DEL MÓDULO 8 (INVENTARIO) PASARON EXITOSAMENTE <<<")
        print("="*70)


if __name__ == "__main__":
    asyncio.run(run_modulo_8_full_test_suite())
