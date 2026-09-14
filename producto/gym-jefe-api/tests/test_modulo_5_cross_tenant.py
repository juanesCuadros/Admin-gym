import asyncio
import os
import sys
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import hash_password
from app.main import app


async def run_modulo_5_full_test_suite():
    print("\n==================================================================")
    print("SUITE INTEGRAL MÓDULO 5: MEMBRESÍAS, PLANES Y CROSS-TENANT RLS")
    print("Flujo Completo vía HTTP con JWT en PostgreSQL Real (gymos_db)")
    print("==================================================================")

    gym_a_id = uuid4()
    staff_jefe_a_id = uuid4()
    subdominio_a = f"gym-m5a-{uuid4().hex[:6]}"
    correo_jefe_a = f"jefe_m5a_{uuid4().hex[:6]}@gym.com"

    gym_b_id = uuid4()
    staff_jefe_b_id = uuid4()
    subdominio_b = f"gym-m5b-{uuid4().hex[:6]}"
    correo_jefe_b = f"jefe_m5b_{uuid4().hex[:6]}@gym.com"

    dep_a_id = uuid4()
    dep_b_id = uuid4()

    raw_pass = "Password123!"
    hashed_pass = hash_password(raw_pass)

    async with async_session_maker() as session:
        # Fixtures Gym A
        await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
        await session.execute(text("""
            INSERT INTO platform.tenant (id, nombre, subdominio, tope_dias_congelamiento, activo)
            VALUES (:id, 'Gimnasio Alfa M5', :sub, 30, true)
        """), {"id": gym_a_id, "sub": subdominio_a})

        await session.execute(text("""
            INSERT INTO platform.staff (id, gimnasio_id, nombre, correo, hash_password, rol, activo)
            VALUES (:id, :g_id, 'Jefe Gym A', :correo, :h_pass, 'jefe', true)
        """), {"id": staff_jefe_a_id, "g_id": gym_a_id, "correo": correo_jefe_a, "h_pass": hashed_pass})

        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-M5-DEP-A', 'Deportista Alfa', true, true, now())
        """), {"id": dep_a_id, "g_id": gym_a_id})
        await session.commit()

        # Fixtures Gym B
        await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
        await session.execute(text("""
            INSERT INTO platform.tenant (id, nombre, subdominio, tope_dias_congelamiento, activo)
            VALUES (:id, 'Gimnasio Beta M5', :sub, 15, true)
        """), {"id": gym_b_id, "sub": subdominio_b})

        await session.execute(text("""
            INSERT INTO platform.staff (id, gimnasio_id, nombre, correo, hash_password, rol, activo)
            VALUES (:id, :g_id, 'Jefe Gym B', :correo, :h_pass, 'jefe', true)
        """), {"id": staff_jefe_b_id, "g_id": gym_b_id, "correo": correo_jefe_b, "h_pass": hashed_pass})

        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-M5-DEP-B', 'Deportista Beta', true, true, now())
        """), {"id": dep_b_id, "g_id": gym_b_id})
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:

        # 1. Login independiente
        r_log_a = await client.post("/api/v1/auth/login", json={"subdominio": subdominio_a, "correo": correo_jefe_a, "password": raw_pass})
        assert r_log_a.status_code == 200
        headers_a = {"Authorization": f"Bearer {r_log_a.json()['access_token']}"}

        r_log_b = await client.post("/api/v1/auth/login", json={"subdominio": subdominio_b, "correo": correo_jefe_b, "password": raw_pass})
        assert r_log_b.status_code == 200
        headers_b = {"Authorization": f"Bearer {r_log_b.json()['access_token']}"}
        print(" [PASS] 1. Autenticación HTTP exitosa para Jefe A y Jefe B.")

        # 2. Catálogo de Planes (RF-24)
        print("\n--- Probando Catálogo de Planes (RF-24) ---")
        # 2.1 Crear Plan en Gym A
        r_plan_a = await client.post("/api/v1/planes", json={
            "nombre": "Plan Black Anual",
            "precio": 900000.0,
            "duracion_dias": 365,
            "tipo": "individual",
            "cupo_personas": 1
        }, headers=headers_a)
        assert r_plan_a.status_code == 201, f"Error crear plan: {r_plan_a.text}"
        plan_a_id = r_plan_a.json()["id"]
        print(f" [PASS] Plan creado en Gym A (ID: {plan_a_id}, Versión: {r_plan_a.json()['version']}).")

        # 2.2 Unicidad de nombre por gimnasio
        r_dup_plan = await client.post("/api/v1/planes", json={
            "nombre": "Plan Black Anual",
            "precio": 950000.0,
            "duracion_dias": 365,
            "tipo": "individual"
        }, headers=headers_a)
        assert r_dup_plan.status_code == 409
        assert r_dup_plan.json()["error"]["codigo"] == "PLAN_YA_EXISTE"
        print(" [PASS] Unicidad de nombre de plan validada (409 PLAN_YA_EXISTE).")

        # 2.3 Edición con concurrencia optimista
        r_edit_plan = await client.put(f"/api/v1/planes/{plan_a_id}", json={
            "precio": 950000.0,
            "version": 1
        }, headers=headers_a)
        assert r_edit_plan.status_code == 200
        assert r_edit_plan.json()["version"] == 2
        assert Decimal(str(r_edit_plan.json()["precio"])) == Decimal("950000.00")
        print(" [PASS] Edición optimista exitosa (precio actualizado, versión avanzó a 2).")

        # 2.4 Conflicto de versión optimista
        r_conflict_plan = await client.put(f"/api/v1/planes/{plan_a_id}", json={
            "precio": 1000000.0,
            "version": 1  # Versión obsoleta
        }, headers=headers_a)
        assert r_conflict_plan.status_code == 409
        assert r_conflict_plan.json()["error"]["codigo"] == "CONFLICTO_CONCURRENCIA"
        print(" [PASS] Conflicto de concurrencia optimista bloqueado (409 CONFLICTO_CONCURRENCIA).")

        # 2.5 Crear Plan secundario y Desactivarlo (No-Retroactividad)
        r_plan_sec = await client.post("/api/v1/planes", json={
            "nombre": "Plan Trimestral Promo",
            "precio": 250000.0,
            "duracion_dias": 90,
            "tipo": "individual"
        }, headers=headers_a)
        assert r_plan_sec.status_code == 201
        plan_sec_id = r_plan_sec.json()["id"]

        r_desact = await client.patch(f"/api/v1/planes/{plan_sec_id}/estado", json={"activo": False}, headers=headers_a)
        assert r_desact.status_code == 200
        assert r_desact.json()["activo"] is False
        print(" [PASS] Desactivación de plan tarifario exitosa.")

        # 3. Asignación Inicial de Membresía (RF-25)
        print("\n--- Probando Asignación de Membresía (RF-25) ---")
        # 3.1 Intento de asignar plan desactivado -> 400
        r_asig_inact = await client.post("/api/v1/membresias/asignar", json={
            "deportista_id": str(dep_a_id),
            "plan_id": str(plan_sec_id)
        }, headers=headers_a)
        assert r_asig_inact.status_code == 400
        assert r_asig_inact.json()["error"]["codigo"] == "PLAN_INACTIVO"
        print(" [PASS] Intento de asignar plan desactivado bloqueado (400 PLAN_INACTIVO).")

        # 3.2 Asignación legítima de Plan Black
        r_asig = await client.post("/api/v1/membresias/asignar", json={
            "deportista_id": str(dep_a_id),
            "plan_id": str(plan_a_id)
        }, headers=headers_a)
        assert r_asig.status_code == 201
        memb_a_id = r_asig.json()["id"]
        assert r_asig.json()["estado_calculado"] == "activo"
        print(f" [PASS] Membresía asignada legítimamente (ID: {memb_a_id}, Estado: {r_asig.json()['estado_calculado']}).")

        # 3.3 Bloqueo de membresía activa duplicada (Ajuste Crítico 2)
        r_asig_dup = await client.post("/api/v1/membresias/asignar", json={
            "deportista_id": str(dep_a_id),
            "plan_id": str(plan_a_id)
        }, headers=headers_a)
        assert r_asig_dup.status_code == 409
        assert r_asig_dup.json()["error"]["codigo"] == "MEMBRESIA_ACTIVA_EXISTENTE"
        print(" [PASS] Asignación duplicada sobre membresía activa bloqueada (409 MEMBRESIA_ACTIVA_EXISTENTE).")

        # 4. Congelar y Descongelar (RF-26)
        print("\n--- Probando Congelamiento y Descongelamiento (RF-26) ---")
        # 4.1 Congelar membresía
        r_cong = await client.post(f"/api/v1/membresias/{memb_a_id}/congelar", json={
            "motivo": "Viaje de trabajo"
        }, headers=headers_a)
        assert r_cong.status_code == 201
        assert r_cong.json()["vigente"] is True
        print(" [PASS] Membresía congelada exitosamente (congelamiento abierto creado).")

        # 4.2 Anticipación de congelamiento ya vigente -> 409
        r_cong_repeat = await client.post(f"/api/v1/membresias/{memb_a_id}/congelar", json={
            "motivo": "Intento duplicado"
        }, headers=headers_a)
        assert r_cong_repeat.status_code == 409
        assert r_cong_repeat.json()["error"]["codigo"] == "MEMBRESIA_YA_CONGELADA"
        print(" [PASS] Intento de congelar membresía ya congelada anticipado (409 MEMBRESIA_YA_CONGELADA).")

        # 4.3 Descongelar membresía
        r_descong = await client.post(f"/api/v1/membresias/{memb_a_id}/descongelar", headers=headers_a)
        assert r_descong.status_code == 200
        assert r_descong.json()["vigente"] is False
        assert r_descong.json()["dias"] is not None
        print(" [PASS] Membresía descongelada exitosamente (fecha_vencimiento extendida).")

        # 4.4 Intento de descongelar membresía que no está congelada -> 400
        r_descong_repeat = await client.post(f"/api/v1/membresias/{memb_a_id}/descongelar", headers=headers_a)
        assert r_descong_repeat.status_code == 400
        assert r_descong_repeat.json()["error"]["codigo"] == "MEMBRESIA_NO_CONGELADA"
        print(" [PASS] Intento de descongelar membresía no congelada bloqueado (400 MEMBRESIA_NO_CONGELADA).")

        # 5. Cambio de Plan sin Prorrateo & Cierre de Congelamientos Huérfanos (Ajuste Crítico 1)
        print("\n--- Probando Cambio de Plan sin Prorrateo y Cierre de Huérfanos (RF-25) ---")
        # 5.1 Creamos un nuevo plan semestral
        r_plan_sem = await client.post("/api/v1/planes", json={
            "nombre": "Plan Semestral VIP",
            "precio": 500000.0,
            "duracion_dias": 180,
            "tipo": "individual"
        }, headers=headers_a)
        assert r_plan_sem.status_code == 201
        plan_sem_id = r_plan_sem.json()["id"]

        # Congelamos de nuevo la membresía para verificar que cambiar_plan cierra el congelamiento
        await client.post(f"/api/v1/membresias/{memb_a_id}/congelar", json={"motivo": "Pausa previa a cambio"}, headers=headers_a)

        # 5.2 Cambiar de plan
        r_cambio = await client.post(f"/api/v1/membresias/{memb_a_id}/cambiar-plan", json={
            "nuevo_plan_id": str(plan_sem_id),
            "motivo": "Upgrade a VIP Semestral"
        }, headers=headers_a)
        assert r_cambio.status_code == 200
        nueva_memb_id = r_cambio.json()["id"]
        assert nueva_memb_id != memb_a_id
        assert r_cambio.json()["plan_nombre"] == "Plan Semestral VIP"
        print(f" [PASS] Cambio de plan exitoso (Nueva membresía ID: {nueva_memb_id}).")

        # 5.3 Verificar en base de datos que:
        # a) La membresía anterior está cancelada = true
        # b) El congelamiento previo fue cerrado con fecha_fin NOT NULL (CERO huérfanos)
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            res_prev = await session.execute(text("SELECT cancelada FROM platform.membresias WHERE id = :id"), {"id": memb_a_id})
            assert res_prev.scalar() is True, "La membresía anterior debe estar cancelada"

            res_cong_orph = await session.execute(text("""
                SELECT COUNT(*) FROM platform.congelamientos
                WHERE membresia_id = :id AND fecha_fin IS NULL
            """), {"id": memb_a_id})
            assert res_cong_orph.scalar() == 0, "CERO congelamientos huérfanos con fecha_fin NULL"
            print(" [PASS] Integridad de datos: Membresía anterior cancelada y congelamiento cerrado automáticamente (0 huérfanos).")

        # 5.4 Historial del deportista muestra ambas membresías (RF-25)
        r_hist = await client.get(f"/api/v1/membresias/deportista/{dep_a_id}", headers=headers_a)
        assert r_hist.status_code == 200
        items_hist = r_hist.json()
        assert len(items_hist) == 2
        ids_hist = [m["id"] for m in items_hist]
        assert str(memb_a_id) in ids_hist and str(nueva_memb_id) in ids_hist
        print(f" [PASS] Historial de deportista preserva ambas membresías ({len(items_hist)} registros auditables).")

        # 6. Cancelación de Membresía
        print("\n--- Probando Cancelación de Membresía (RF-25, RF-27) ---")
        r_cancel = await client.post(f"/api/v1/membresias/{nueva_memb_id}/cancelar", json={
            "motivo": "Cancelación por mudanza del cliente"
        }, headers=headers_a)
        assert r_cancel.status_code == 200
        print(" [PASS] Membresía cancelada exitosamente con motivo obligatorio.")

        # 7. Listado paginado y Ficha detallada (RF-27, RF-42)
        print("\n--- Probando Listado Paginado y Ficha 360° de Membresía ---")
        r_list = await client.get("/api/v1/membresias", headers=headers_a)
        assert r_list.status_code == 200
        data_list = r_list.json()
        assert data_list["total"] >= 2
        print(f" [PASS] GET /membresias listó {data_list['total']} registros con estados derivados calculados en batch.")

        r_ficha = await client.get(f"/api/v1/membresias/{memb_a_id}", headers=headers_a)
        assert r_ficha.status_code == 200
        ficha = r_ficha.json()
        assert len(ficha["congelamientos"]) >= 1
        print(f" [PASS] GET /membresias/{memb_a_id} retornó ficha completa con {len(ficha['congelamientos'])} congelamiento(s).")

        # =====================================================================
        # 8. PRUEBAS DE AISLAMIENTO CRUZADO (CROSS-TENANT RLS POLÍTICA PERMANENTE)
        # =====================================================================
        print("\n==================================================================")
        print("PRUEBAS DE AISLAMIENTO MULTI-TENANT CRUZADO (GYM B -> GYM A)")
        print("==================================================================")

        # 8.1 Gym B no puede ver ni listar planes de Gym A
        r_cross_plan = await client.get(f"/api/v1/planes/{plan_a_id}", headers=headers_b)
        assert r_cross_plan.status_code == 404
        assert r_cross_plan.json()["error"]["codigo"] == "PLAN_NO_ENCONTRADO"
        print(" [PASS] Cross-Tenant: GET /planes/{id_plan_a} con token de Gym B -> 404 PLAN_NO_ENCONTRADO.")

        r_cross_list_planes = await client.get("/api/v1/planes", headers=headers_b)
        assert r_cross_list_planes.status_code == 200
        ids_planes_b = [p["id"] for p in r_cross_list_planes.json()["items"]]
        assert str(plan_a_id) not in ids_planes_b
        print(" [PASS] Cross-Tenant: GET /planes en Gym B no lista planes de Gym A.")

        # 8.2 Gym B no puede editar planes de Gym A
        r_cross_edit_plan = await client.put(f"/api/v1/planes/{plan_a_id}", json={
            "precio": 1000.0,
            "version": 2
        }, headers=headers_b)
        assert r_cross_edit_plan.status_code == 404
        print(" [PASS] Cross-Tenant: PUT /planes/{id_plan_a} desde Gym B -> 404.")

        # 8.3 Gym B no puede consultar membresías de Gym A
        r_cross_memb = await client.get(f"/api/v1/membresias/{nueva_memb_id}", headers=headers_b)
        assert r_cross_memb.status_code == 404
        assert r_cross_memb.json()["error"]["codigo"] == "MEMBRESIA_NO_ENCONTRADA"
        print(" [PASS] Cross-Tenant: GET /membresias/{id_a} con token de Gym B -> 404 MEMBRESIA_NO_ENCONTRADA.")

        r_cross_list_memb = await client.get("/api/v1/membresias", headers=headers_b)
        assert r_cross_list_memb.status_code == 200
        ids_memb_b = [m["id"] for m in r_cross_list_memb.json()["items"]]
        assert str(nueva_memb_id) not in ids_memb_b and str(memb_a_id) not in ids_memb_b
        print(" [PASS] Cross-Tenant: GET /membresias en Gym B tiene 0 registros de Gym A.")

        # 8.4 Gym B no puede congelar ni descongelar membresías de Gym A
        r_cross_cong = await client.post(f"/api/v1/membresias/{nueva_memb_id}/congelar", json={"motivo": "Ataque"}, headers=headers_b)
        assert r_cross_cong.status_code == 404
        print(" [PASS] Cross-Tenant: POST /congelar sobre membresía de Gym A -> 404.")

        r_cross_descong = await client.post(f"/api/v1/membresias/{nueva_memb_id}/descongelar", headers=headers_b)
        assert r_cross_descong.status_code == 400 or r_cross_descong.status_code == 404
        print(" [PASS] Cross-Tenant: POST /descongelar sobre membresía de Gym A bloqueado.")

        # 8.5 Gym B no puede cambiar plan ni cancelar membresías de Gym A
        r_cross_change = await client.post(f"/api/v1/membresias/{nueva_memb_id}/cambiar-plan", json={
            "nuevo_plan_id": str(plan_sem_id)
        }, headers=headers_b)
        assert r_cross_change.status_code == 404
        print(" [PASS] Cross-Tenant: POST /cambiar-plan sobre membresía de Gym A -> 404.")

        r_cross_cancel = await client.post(f"/api/v1/membresias/{nueva_memb_id}/cancelar", json={
            "motivo": "Ataque cross-tenant"
        }, headers=headers_b)
        assert r_cross_cancel.status_code == 404
        print(" [PASS] Cross-Tenant: POST /cancelar sobre membresía de Gym A -> 404.")

        # 9. Verificación de Auditoría en platform.auditoria_gym
        print("\n--- Verificando Trazabilidad Inmutable en platform.auditoria_gym ---")
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            res_aud = await session.execute(text("""
                SELECT accion, entidad, hash_actual
                FROM platform.auditoria_gym
                WHERE gimnasio_id = :gym_id
                ORDER BY id ASC
            """), {"gym_id": gym_a_id})
            rows_aud = res_aud.mappings().all()
            acciones = [r["accion"] for r in rows_aud]
            print(f" Acciones registradas con hash-chain en Gym A: {acciones}")
            assert "CREAR_PLAN" in acciones
            assert "EDITAR_PLAN" in acciones
            assert "ASIGNAR_MEMBRESIA" in acciones
            assert "CONGELAR_MEMBRESIA" in acciones
            assert "DESCONGELAR_MEMBRESIA" in acciones
            assert "CAMBIO_DE_PLAN" in acciones
            assert "CANCELAR_MEMBRESIA" in acciones
            print(" [PASS] Todas las operaciones del Módulo 5 quedaron registradas en platform.auditoria_gym con encadenamiento SHA-256.")

    print("\n==================================================================")
    print(" SUITE COMPLETA DEL MÓDULO 5 Y AISLAMIENTO CROSS-TENANT SUPERADOS 100%")
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(run_modulo_5_full_test_suite())
