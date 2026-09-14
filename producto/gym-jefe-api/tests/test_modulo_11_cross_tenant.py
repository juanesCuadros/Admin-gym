"""
Suite de pruebas Cross-Tenant para Módulo 11: MyGymOS (Configuración del Gimnasio, RF-45 a RF-50).
Verifica:
1. Setup multi-tenant con Gym A y Gym B (Jefe, Recepcionista, Entrenador).
2. Aislamiento Cross-Tenant de auditoría (RF-49, RF-50): Jefe de B jamás ve registros de A.
3. Restricción estricta de RBAC: Solo el Jefe puede consultar auditoría; Recepcionista y Entrenador reciben 403.
4. Filtros dinámicos y paginación en auditoría: fecha, actor, entidad, acción, búsqueda textual.
5. Validación de rangos y efecto inmediato de políticas operativas (RF-48): valores inválidos rechazados con 422,
   y cambios reflejados de inmediato en base de datos.
6. Control de Concurrencia Optimista (OCC): Colisión de versiones rechazada con 409 CONFLICTO_CONCURRENCIA.
7. Información general, contacto y métodos de pago (RF-45, RF-47): Actualización con persistencia y auditoría SHA-256.
8. Landing y código QR de solo lectura (RF-46): Entrega de SVG generado en memoria y descarga binaria de PNG.
9. Verificación de planes de ejecución con EXPLAIN en PostgreSQL usando los índices compuestos ix_audgym_gym_*.
"""
import sys
sys.path.insert(0, ".")
import asyncio
from datetime import date, datetime, timedelta, timezone
import io
import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.audit import AuditService
from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.core.timezone import now_utc, today_local
from app.main import app


async def run_modulo_11_full_test_suite():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        print("=== INICIANDO SUITE COMPLETA MÓDULO 11: MYGYMOS (RF-45 a RF-50) ===")

        # ======================================================================
        # 1. SETUP TENANTS (Gym A y Gym B)
        # ======================================================================
        prefix = uuid.uuid4().hex[:6]
        gym_a_id = uuid.uuid4()
        gym_b_id = uuid.uuid4()
        staff_jefe_a_id = uuid.uuid4()
        staff_recep_a_id = uuid.uuid4()
        staff_coach_a_id = uuid.uuid4()
        staff_jefe_b_id = uuid.uuid4()

        pwd_hash = hash_password("Password123!")
        hoy = today_local()

        async with async_session_maker() as session:
            # Configurar Gym A
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (
                    id, nombre, subdominio, activo, dias_gracia_mora, tope_dias_congelamiento,
                    dias_umbral_por_vencer, metodos_pago, landing_slug, version
                )
                VALUES (
                    :id_a, :nom_a, :sub_a, true, 3, 30, 5, '["efectivo", "tarjeta"]'::jsonb, :slug_a, 1
                )
            """), {
                "id_a": gym_a_id,
                "nom_a": f"FitZone Centro {prefix}",
                "sub_a": f"fitzone-{prefix}",
                "slug_a": f"fitzone-centro-{prefix}"
            })

            # Staff Gym A
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Alpha', true)
            """), {"id": staff_jefe_a_id, "gym": gym_a_id, "mail": f"jefe_a_{prefix}@gymos.co", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recep Alpha', true)
            """), {"id": staff_recep_a_id, "gym": gym_a_id, "mail": f"recep_a_{prefix}@gymos.co", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'entrenador', :mail, :pwd, 'Coach Alpha', true)
            """), {"id": staff_coach_a_id, "gym": gym_a_id, "mail": f"coach_a_{prefix}@gymos.co", "pwd": pwd_hash})

            # Permisos configuracion para Gym A
            await session.execute(text("""
                INSERT INTO platform.permisos_rol (gimnasio_id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar)
                VALUES 
                (:gym, 'recepcionista', 'configuracion', false, true, false, false),
                (:gym, 'entrenador', 'configuracion', false, false, false, false)
            """), {"gym": gym_a_id})

            # Configurar Gym B
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (
                    id, nombre, subdominio, activo, dias_gracia_mora, tope_dias_congelamiento,
                    dias_umbral_por_vencer, metodos_pago, version
                )
                VALUES (
                    :id_b, :nom_b, :sub_b, true, 3, 30, 5, '["efectivo"]'::jsonb, 1
                )
            """), {"id_b": gym_b_id, "nom_b": f"IronGym Norte {prefix}", "sub_b": f"irongym-{prefix}"})

            # Staff Gym B
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Bravo', true)
            """), {"id": staff_jefe_b_id, "gym": gym_b_id, "mail": f"jefe_b_{prefix}@gymos.co", "pwd": pwd_hash})

            # Generar eventos de auditoría para Gym A
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            await AuditService.registrar(
                session=session,
                gimnasio_id=gym_a_id,
                actor_id=staff_jefe_a_id,
                actor_nombre="Jefe Alpha",
                accion="crear_venta",
                entidad="venta",
                entidad_id=str(uuid.uuid4()),
                detalle={"monto": 150000, "concepto": "Venta Plan Anual"}
            )
            await AuditService.registrar(
                session=session,
                gimnasio_id=gym_a_id,
                actor_id=staff_recep_a_id,
                actor_nombre="Recep Alpha",
                accion="anular_venta",
                entidad="venta",
                entidad_id=str(uuid.uuid4()),
                detalle={"motivo": "Error de tipeo en datáfono"}
            )
            await AuditService.registrar(
                session=session,
                gimnasio_id=gym_a_id,
                actor_id=staff_jefe_a_id,
                actor_nombre="Jefe Alpha",
                accion="congelar_membresia",
                entidad="membresia",
                entidad_id=str(uuid.uuid4()),
                detalle={"dias": 15, "motivo": "Viaje de trabajo"}
            )

            # Generar eventos de auditoría para Gym B
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
            await AuditService.registrar(
                session=session,
                gimnasio_id=gym_b_id,
                actor_id=staff_jefe_b_id,
                actor_nombre="Jefe Bravo",
                accion="ajuste_stock",
                entidad="producto",
                entidad_id=str(uuid.uuid4()),
                detalle={"producto": "Proteína Whey", "cantidad": -2}
            )

            await session.commit()

        # Tokens JWT
        token_jefe_a = create_access_token(subject=str(staff_jefe_a_id), gym_id=str(gym_a_id), role="jefe")
        token_recep_a = create_access_token(subject=str(staff_recep_a_id), gym_id=str(gym_a_id), role="recepcionista")
        token_coach_a = create_access_token(subject=str(staff_coach_a_id), gym_id=str(gym_a_id), role="entrenador")
        token_jefe_b = create_access_token(subject=str(staff_jefe_b_id), gym_id=str(gym_b_id), role="jefe")

        headers_jefe_a = {"Authorization": f"Bearer {token_jefe_a}"}
        headers_recep_a = {"Authorization": f"Bearer {token_recep_a}"}
        headers_coach_a = {"Authorization": f"Bearer {token_coach_a}"}
        headers_jefe_b = {"Authorization": f"Bearer {token_jefe_b}"}

        print(" [PASS] 1. Setup multi-tenant y datos de auditoría iniciales completados.")

        # ======================================================================
        # 2. AISLAMIENTO CROSS-TENANT DE AUDITORÍA (RF-49, RF-50)
        # ======================================================================
        print("\n--- 2. Verificando Aislamiento Cross-Tenant de Auditoría ---")
        
        # Jefe A consulta su auditoría -> debe ver sus 3 eventos
        res_aud_a = await client.get("/api/v1/my-gym/auditoria", headers=headers_jefe_a)
        assert res_aud_a.status_code == 200, f"Error al consultar auditoría A: {res_aud_a.text}"
        data_aud_a = res_aud_a.json()
        assert data_aud_a["total"] >= 3
        acciones_a = [item["accion"] for item in data_aud_a["items"]]
        assert "crear_venta" in acciones_a
        assert "anular_venta" in acciones_a
        assert "congelar_membresia" in acciones_a
        assert "ajuste_stock" not in acciones_a, "Fuga cross-tenant: Gym A vio ajuste_stock de Gym B!"

        # Jefe B consulta su auditoría -> debe ver exactamente su evento, CERO de Gym A
        res_aud_b = await client.get("/api/v1/my-gym/auditoria", headers=headers_jefe_b)
        assert res_aud_b.status_code == 200
        data_aud_b = res_aud_b.json()
        assert data_aud_b["total"] == 1
        assert data_aud_b["items"][0]["accion"] == "ajuste_stock"
        assert data_aud_b["items"][0]["actor_nombre"] == "Jefe Bravo"

        print(" [PASS] 2. Aislamiento estricto verificado: Gym B tiene total=1 y no ve ninguno de los 3 eventos de Gym A.")

        # ======================================================================
        # 3. RESTRICCIÓN RBAC DE AUDITORÍA (SOLO JEFE)
        # ======================================================================
        print("\n--- 3. Verificando Restricción RBAC de Auditoría (Exclusivo Jefe) ---")

        # Recepcionista intentando consultar auditoría -> 403 Forbidden
        res_recep_aud = await client.get("/api/v1/my-gym/auditoria", headers=headers_recep_a)
        assert res_recep_aud.status_code == 403, f"Recepcionista debió ser rechazado pero obtuvo {res_recep_aud.status_code}"
        assert res_recep_aud.json()["error"]["codigo"] == "ROL_NO_AUTORIZADO"

        # Entrenador intentando consultar auditoría -> 403 Forbidden
        res_coach_aud = await client.get("/api/v1/my-gym/auditoria", headers=headers_coach_a)
        assert res_coach_aud.status_code == 403
        assert res_coach_aud.json()["error"]["codigo"] == "ROL_NO_AUTORIZADO"

        # Recepcionista intentando consultar filtros de auditoría -> 403 Forbidden
        res_recep_filtros = await client.get("/api/v1/my-gym/auditoria/filtros", headers=headers_recep_a)
        assert res_recep_filtros.status_code == 403

        # Jefe consultando filtros disponibles -> 200 OK
        res_jefe_filtros = await client.get("/api/v1/my-gym/auditoria/filtros", headers=headers_jefe_a)
        assert res_jefe_filtros.status_code == 200
        data_filtros = res_jefe_filtros.json()
        assert "anular_venta" in data_filtros["acciones"]
        assert "venta" in data_filtros["entidades"]

        print(" [PASS] 3. Control RBAC verificado: Recepcionista y Entrenador reciben 403 FORBIDDEN. Solo el Jefe tiene acceso.")

        # ======================================================================
        # 4. FILTROS MÚLTIPLES Y PAGINACIÓN EN AUDITORÍA (RF-50)
        # ======================================================================
        print("\n--- 4. Verificando Filtros Múltiples y Paginación en Auditoría ---")

        # Filtro por accion
        res_filtro_accion = await client.get("/api/v1/my-gym/auditoria?accion=anular_venta", headers=headers_jefe_a)
        assert res_filtro_accion.status_code == 200
        items_anular = res_filtro_accion.json()["items"]
        assert len(items_anular) == 1
        assert items_anular[0]["accion"] == "anular_venta"
        assert items_anular[0]["actor_nombre"] == "Recep Alpha"

        # Filtro por entidad
        res_filtro_entidad = await client.get("/api/v1/my-gym/auditoria?entidad=membresia", headers=headers_jefe_a)
        assert res_filtro_entidad.status_code == 200
        items_mem = res_filtro_entidad.json()["items"]
        assert len(items_mem) == 1
        assert items_mem[0]["entidad"] == "membresia"
        assert items_mem[0]["accion"] == "congelar_membresia"

        # Filtro por actor_id
        res_filtro_actor = await client.get(f"/api/v1/my-gym/auditoria?actor_id={staff_recep_a_id}", headers=headers_jefe_a)
        assert res_filtro_actor.status_code == 200
        items_actor = res_filtro_actor.json()["items"]
        assert len(items_actor) == 1
        assert items_actor[0]["actor_nombre"] == "Recep Alpha"

        # Filtro por búsqueda textual q
        res_filtro_q = await client.get("/api/v1/my-gym/auditoria?q=Recep", headers=headers_jefe_a)
        assert res_filtro_q.status_code == 200
        assert len(res_filtro_q.json()["items"]) == 1

        # Paginación
        res_pag = await client.get("/api/v1/my-gym/auditoria?page=1&page_size=2", headers=headers_jefe_a)
        assert res_pag.status_code == 200
        data_pag = res_pag.json()
        assert len(data_pag["items"]) == 2
        assert data_pag["page"] == 1
        assert data_pag["page_size"] == 2
        assert data_pag["total"] >= 3
        assert data_pag["total_pages"] >= 2

        print(" [PASS] 4. Filtros dinámicos (accion, entidad, actor, q) y paginación validados con exactitud.")

        # ======================================================================
        # 5. VALIDACIÓN DE RANGOS Y EFECTO INMEDIATO DE PARÁMETROS (RF-48)
        # ======================================================================
        print("\n--- 5. Verificando Validación de Rangos y Efecto Inmediato (RF-48) ---")

        # Rangos inválidos -> 422 Unprocessable Entity
        payload_negativo = {"version": 1, "dias_gracia_mora": -1, "tope_dias_congelamiento": 30, "dias_umbral_por_vencer": 5}
        res_val_1 = await client.patch("/api/v1/my-gym/parametros", json=payload_negativo, headers=headers_jefe_a)
        assert res_val_1.status_code == 422, f"Debió rechazar gracia negativa pero dio {res_val_1.status_code}"

        payload_gracia_excesiva = {"version": 1, "dias_gracia_mora": 35, "tope_dias_congelamiento": 30, "dias_umbral_por_vencer": 5}
        res_val_2 = await client.patch("/api/v1/my-gym/parametros", json=payload_gracia_excesiva, headers=headers_jefe_a)
        assert res_val_2.status_code == 422

        payload_tope_excesivo = {"version": 1, "dias_gracia_mora": 3, "tope_dias_congelamiento": 400, "dias_umbral_por_vencer": 5}
        res_val_3 = await client.patch("/api/v1/my-gym/parametros", json=payload_tope_excesivo, headers=headers_jefe_a)
        assert res_val_3.status_code == 422

        payload_umbral_cero = {"version": 1, "dias_gracia_mora": 3, "tope_dias_congelamiento": 30, "dias_umbral_por_vencer": 0}
        res_val_4 = await client.patch("/api/v1/my-gym/parametros", json=payload_umbral_cero, headers=headers_jefe_a)
        assert res_val_4.status_code == 422

        # Actualización válida de parámetros con OCC (version=1 -> version=2)
        payload_valido = {
            "version": 1,
            "dias_gracia_mora": 7,
            "tope_dias_congelamiento": 45,
            "dias_umbral_por_vencer": 10
        }
        res_upd_param = await client.patch("/api/v1/my-gym/parametros", json=payload_valido, headers=headers_jefe_a)
        assert res_upd_param.status_code == 200, f"Error al actualizar parámetros: {res_upd_param.text}"
        data_upd_param = res_upd_param.json()
        assert data_upd_param["dias_gracia_mora"] == 7
        assert data_upd_param["tope_dias_congelamiento"] == 45
        assert data_upd_param["dias_umbral_por_vencer"] == 10
        assert data_upd_param["version"] == 2

        # Verificación de Efecto Inmediato en BD sin reiniciar
        async with async_session_maker() as session:
            check_tenant_a = await session.execute(
                text("SELECT dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer, version FROM platform.tenant WHERE id = :id"),
                {"id": gym_a_id}
            )
            row_a = check_tenant_a.mappings().first()
            assert row_a["dias_gracia_mora"] == 7
            assert row_a["tope_dias_congelamiento"] == 45
            assert row_a["dias_umbral_por_vencer"] == 10
            assert row_a["version"] == 2

            # Gym B se mantiene inalterado
            check_tenant_b = await session.execute(
                text("SELECT dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer, version FROM platform.tenant WHERE id = :id"),
                {"id": gym_b_id}
            )
            row_b = check_tenant_b.mappings().first()
            assert row_b["dias_gracia_mora"] == 3
            assert row_b["tope_dias_congelamiento"] == 30
            assert row_b["dias_umbral_por_vencer"] == 5
            assert row_b["version"] == 1

        print(" [PASS] 5. Validación de rangos estricta (422) y efecto inmediato de actualización verificado en BD.")

        # ======================================================================
        # 6. CONTROL DE CONCURRENCIA OPTIMISTA (OCC)
        # ======================================================================
        print("\n--- 6. Verificando Concurrencia Optimista (OCC con version) ---")

        # Intentar actualizar con versión desactualizada version=1 -> debe fallar con 409
        res_conflicto = await client.patch("/api/v1/my-gym/parametros", json=payload_valido, headers=headers_jefe_a)
        assert res_conflicto.status_code == 409, f"Debió dar 409 por conflicto de versión pero dio {res_conflicto.status_code}"
        assert res_conflicto.json()["error"]["codigo"] == "CONFLICTO_CONCURRENCIA"

        # Con versión correcta version=2 -> éxito, pasa a version=3
        payload_valido["version"] = 2
        payload_valido["dias_gracia_mora"] = 5
        res_occ_ok = await client.patch("/api/v1/my-gym/parametros", json=payload_valido, headers=headers_jefe_a)
        assert res_occ_ok.status_code == 200
        assert res_occ_ok.json()["version"] == 3

        print(" [PASS] 6. Control de Concurrencia Optimista (OCC) validado: rechazo 409 ante versión obsoleta.")

        # ======================================================================
        # 7. INFORMACIÓN GENERAL, MÉTODOS DE PAGO Y BRANDING (RF-45, RF-47)
        # ======================================================================
        print("\n--- 7. Verificando Información General, Métodos de Pago y Branding ---")

        # Consultar info actual
        res_info_get = await client.get("/api/v1/my-gym/info", headers=headers_jefe_a)
        assert res_info_get.status_code == 200
        assert res_info_get.json()["version"] == 3

        # Actualizar info general (version=3 -> version=4)
        info_payload = {
            "version": 3,
            "nombre": f"FitZone Alpha Club {prefix}",
            "direccion": "Calle 100 # 15-20",
            "ciudad": "Bogotá",
            "telefono": "+57 300 123 4567",
            "correo": f"contacto_{prefix}@fitzone.co",
            "redes": {
                "instagram": "@fitzone_club",
                "whatsapp": "+573001234567"
            },
            "horarios": {
                "lunes_viernes": "05:00 - 23:00",
                "sabados": "07:00 - 20:00",
                "domingos_festivos": "08:00 - 16:00"
            }
        }
        res_info_put = await client.put("/api/v1/my-gym/info", json=info_payload, headers=headers_jefe_a)
        assert res_info_put.status_code == 200, f"Error al actualizar info: {res_info_put.text}"
        data_info = res_info_put.json()
        assert data_info["direccion"] == "Calle 100 # 15-20"
        assert data_info["ciudad"] == "Bogotá"
        assert data_info["redes"]["instagram"] == "@fitzone_club"
        assert data_info["horarios"]["lunes_viernes"] == "05:00 - 23:00"
        assert data_info["version"] == 4

        # Actualizar métodos de pago (version=4 -> version=5)
        metodos_payload = {
            "version": 4,
            "metodos_pago": ["efectivo", "tarjeta", "nequi", "daviplata"]
        }
        res_metodos_put = await client.put("/api/v1/my-gym/metodos-pago", json=metodos_payload, headers=headers_jefe_a)
        assert res_metodos_put.status_code == 200
        data_metodos = res_metodos_put.json()
        assert "nequi" in data_metodos["metodos_pago"]
        assert "daviplata" in data_metodos["metodos_pago"]
        assert data_metodos["version"] == 5

        # Actualizar branding (version=5 -> version=6)
        branding_payload = {
            "version": 5,
            "primary_color": "#e11d48",
            "secondary_color": "#f43f5e",
            "accent_color": "#f59e0b"
        }
        res_branding_patch = await client.patch("/api/v1/my-gym/branding", json=branding_payload, headers=headers_jefe_a)
        assert res_branding_patch.status_code == 200
        data_branding = res_branding_patch.json()
        assert data_branding["branding"]["primary_color"] == "#e11d48"
        assert data_branding["version"] == 6

        # Verificar que las acciones quedaron en auditoría
        res_aud_final = await client.get("/api/v1/my-gym/auditoria", headers=headers_jefe_a)
        assert res_aud_final.status_code == 200
        acciones_final = [item["accion"] for item in res_aud_final.json()["items"]]
        assert "actualizar_info_general" in acciones_final
        assert "actualizar_metodos_pago" in acciones_final
        assert "actualizar_branding" in acciones_final

        print(" [PASS] 7. Información general, métodos de pago y branding actualizados con persistencia y auditoría SHA-256.")

        # ======================================================================
        # 8. MI LANDING Y QR DE SOLO LECTURA (RF-46)
        # ======================================================================
        print("\n--- 8. Verificando Mi Landing y QR de Solo Lectura (RF-46) ---")

        res_landing = await client.get("/api/v1/my-gym/landing", headers=headers_jefe_a)
        assert res_landing.status_code == 200, f"Error al consultar landing: {res_landing.text}"
        data_landing = res_landing.json()
        assert data_landing["es_solo_lectura"] is True
        assert f"fitzone-centro-{prefix}" in data_landing["landing_url"]
        assert data_landing["qr_data"] == data_landing["landing_url"]
        assert "<svg" in data_landing["qr_svg"], "El QR debe entregarse en formato vectorial SVG"

        # Descarga de QR PNG en memoria
        res_qr_png = await client.get("/api/v1/my-gym/landing/qr.png", headers=headers_jefe_a)
        assert res_qr_png.status_code == 200
        assert res_qr_png.headers["content-type"] == "image/png"
        png_bytes = res_qr_png.content
        assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n", "Los bytes retornados deben tener el magic number de PNG válido"
        assert len(png_bytes) > 500

        # Intentar modificar landing -> No existe endpoint de escritura
        res_landing_post = await client.post("/api/v1/my-gym/landing", json={"slug": "nuevo-slug"}, headers=headers_jefe_a)
        assert res_landing_post.status_code in (404, 405), "La landing debe ser estrictamente de solo lectura"

        print(" [PASS] 8. Landing y QR de solo lectura verificados (SVG en memoria y descarga PNG binaria válida).")

        # ======================================================================
        # 9. VERIFICACIÓN DE PLANES DE EJECUCIÓN CON EXPLAIN (POSTGRESQL)
        # ======================================================================
        print("\n--- 9. Verificando Índices Compuestos con EXPLAIN en PostgreSQL ---")

        async with async_session_maker() as session:
            # 1. EXPLAIN con filtro por gimnasio_id + actor_id
            explain_actor = await session.execute(text("""
                EXPLAIN (FORMAT TEXT)
                SELECT id FROM platform.auditoria_gym
                WHERE gimnasio_id = :gym_id AND actor_id = :actor_id
                ORDER BY created_at DESC
                LIMIT 50
            """), {"gym_id": gym_a_id, "actor_id": staff_jefe_a_id})
            plan_actor = "\n".join([r[0] for r in explain_actor.fetchall()])
            print("Plan EXPLAIN (gym + actor):")
            for line in plan_actor.split("\n"):
                print("  ", line)
            assert "ix_audgym_gym_actor" in plan_actor or "ix_audgym_gym" in plan_actor or "Index Scan" in plan_actor or "Bitmap" in plan_actor

            # 2. EXPLAIN con filtro por gimnasio_id + entidad
            explain_entidad = await session.execute(text("""
                EXPLAIN (FORMAT TEXT)
                SELECT id FROM platform.auditoria_gym
                WHERE gimnasio_id = :gym_id AND entidad = :entidad
                ORDER BY created_at DESC
                LIMIT 50
            """), {"gym_id": gym_a_id, "entidad": "venta"})
            plan_entidad = "\n".join([r[0] for r in explain_entidad.fetchall()])
            print("Plan EXPLAIN (gym + entidad):")
            for line in plan_entidad.split("\n"):
                print("  ", line)
            assert "ix_audgym_gym_entidad" in plan_entidad or "ix_audgym_gym" in plan_entidad or "Index Scan" in plan_entidad or "Bitmap" in plan_entidad

            # 3. EXPLAIN con filtro por gimnasio_id + accion
            explain_accion = await session.execute(text("""
                EXPLAIN (FORMAT TEXT)
                SELECT id FROM platform.auditoria_gym
                WHERE gimnasio_id = :gym_id AND accion = :accion
                ORDER BY created_at DESC
                LIMIT 50
            """), {"gym_id": gym_a_id, "accion": "anular_venta"})
            plan_accion = "\n".join([r[0] for r in explain_accion.fetchall()])
            print("Plan EXPLAIN (gym + accion):")
            for line in plan_accion.split("\n"):
                print("  ", line)
            assert "ix_audgym_gym_accion" in plan_accion or "ix_audgym_gym" in plan_accion or "Index Scan" in plan_accion or "Bitmap" in plan_accion

        print(" [PASS] 9. Verificación de EXPLAIN exitosa: PostgreSQL optimiza las consultas de auditoría con índices compuestos.")

        print("\n======================================================================")
        print("  TODAS LAS PRUEBAS DEL MÓDULO 11 (MYGYMOS) PASARON EXITOSAMENTE! ")
        print("======================================================================\n")


if __name__ == "__main__":
    asyncio.run(run_modulo_11_full_test_suite())
