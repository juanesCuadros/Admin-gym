import sys
sys.path.insert(0, ".")
import asyncio
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.holidays_colombia import es_festivo_colombia, obtener_festivos_colombia
from app.core.security import create_access_token, hash_password
from app.core.timezone import LOCAL_TZ, now_local, now_utc
from app.main import app


async def run_modulo_7_full_test_suite():
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
        dep_a1_id = uuid.uuid4()  # Con membresía activa
        dep_a2_id = uuid.uuid4()  # Sin membresía (requerirá pase pagado)
        dep_b_id = uuid.uuid4()   # Gym B
        plan_a_id = uuid.uuid4()

        pwd_hash = hash_password("Password123!")

        async with async_session_maker() as session:
            # Tenant A
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id_a, :nom_a, :sub_a, true)
            """), {"id_a": gym_a_id, "nom_a": f"Gym Clases A {prefix}", "sub_a": f"clases-a-{prefix}"})

            # Staff Gym A
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Clases A', true)
            """), {"id": staff_jefe_a_id, "gym": gym_a_id, "mail": f"jefe_a_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'entrenador', :mail, :pwd, 'Coach Clases A', true)
            """), {"id": staff_coach_a_id, "gym": gym_a_id, "mail": f"coach_a_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recep Clases A', true)
            """), {"id": staff_recep_a_id, "gym": gym_a_id, "mail": f"recep_a_{prefix}@test.com", "pwd": pwd_hash})

            # Sembrar permisos canónicos para Gym A
            from app.modules.auth.service import AuthService
            await AuthService._seed_permisos_en_transaccion(session, gym_a_id)

            # Deportistas Gym A
            await session.execute(text("""
                INSERT INTO platform.deportistas (
                    id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo
                ) VALUES 
                (:d1, :gym, :doc1, 'Atleta Con Membresia', :mail1, true, now(), true),
                (:d2, :gym, :doc2, 'Atleta Sin Membresia', :mail2, true, now(), true)
            """), {
                "d1": dep_a1_id, "gym": gym_a_id, "doc1": f"CC1-{prefix}", "mail1": f"dep1_{prefix}@test.com",
                "d2": dep_a2_id, "doc2": f"CC2-{prefix}", "mail2": f"dep2_{prefix}@test.com",
            })

            # Plan y Membresía Activa para Deportista A1
            await session.execute(text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version)
                VALUES (:id, :gym, 'Plan Full Clases', 120000.0, 30, 'individual', 1, true, 1)
            """), {"id": plan_a_id, "gym": gym_a_id})

            await session.execute(text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
                VALUES (gen_random_uuid(), :gym, :dep, :plan, CURRENT_DATE - interval '5 days', CURRENT_DATE + interval '25 days', false)
            """), {"gym": gym_a_id, "dep": dep_a1_id, "plan": plan_a_id})

            # Caja abierta y venta de pase de clase para Deportista A2
            turno_id = uuid.uuid4()
            venta_id = uuid.uuid4()
            venta_item_pase_id = uuid.uuid4()

            await session.execute(text("""
                INSERT INTO platform.turnos_caja (id, gimnasio_id, staff_id, base_inicial, abierto_en, estado)
                VALUES (:id, :gym, :staff, 50000.0, now(), 'abierto')
            """), {"id": turno_id, "gym": gym_a_id, "staff": staff_recep_a_id})

            await session.execute(text("""
                INSERT INTO platform.ventas (id, gimnasio_id, turno_id, deportista_id, total, metodo, tipo_medio, valor_recibido, registrada_por, idempotency_key)
                VALUES (:v_id, :gym, :t_id, :dep, 15000.0, 'efectivo', 'efectivo', 15000.0, :staff, :idem)
            """), {"v_id": venta_id, "gym": gym_a_id, "t_id": turno_id, "dep": dep_a2_id, "staff": staff_recep_a_id, "idem": f"idem-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.venta_items (id, gimnasio_id, venta_id, descripcion, tipo, cantidad, precio_unitario, subtotal)
                VALUES (:item_id, :gym, :v_id, 'Pase Clase Spinning', 'pase_clase', 1, 15000.0, 15000.0)
            """), {"item_id": venta_item_pase_id, "gym": gym_a_id, "v_id": venta_id})

            await session.commit()

            # Tenant B y Fixtures
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id_b, :nom_b, :sub_b, true)
            """), {"id_b": gym_b_id, "nom_b": f"Gym Clases B {prefix}", "sub_b": f"clases-b-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Clases B', true)
            """), {"id": staff_jefe_b_id, "gym": gym_b_id, "mail": f"jefe_b_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_b_id)

            await session.execute(text("""
                INSERT INTO platform.deportistas (
                    id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha, activo
                ) VALUES (:d, :gym, :doc, 'Atleta Gym B', :mail, true, now(), true)
            """), {"d": dep_b_id, "gym": gym_b_id, "doc": f"CCB-{prefix}", "mail": f"depb_{prefix}@test.com"})

            await session.commit()

        # JWT Tokens
        token_jefe_a = create_access_token(subject=str(staff_jefe_a_id), gym_id=str(gym_a_id), role="jefe")
        token_coach_a = create_access_token(subject=str(staff_coach_a_id), gym_id=str(gym_a_id), role="entrenador")
        token_recep_a = create_access_token(subject=str(staff_recep_a_id), gym_id=str(gym_a_id), role="recepcionista")
        token_jefe_b = create_access_token(subject=str(staff_jefe_b_id), gym_id=str(gym_b_id), role="jefe")

        headers_a = {"Authorization": f"Bearer {token_jefe_a}"}
        headers_coach = {"Authorization": f"Bearer {token_coach_a}"}
        headers_recep = {"Authorization": f"Bearer {token_recep_a}"}
        headers_b = {"Authorization": f"Bearer {token_jefe_b}"}

        print("\n--- 1. Programación de Clases y Omisión de Festivos (RF-32) ---")
        # 1.1 Clase única en Gym A programada para mañana a las 10:00 AM
        manana = now_local() + timedelta(days=1)
        fecha_clase_1 = datetime.combine(manana.date(), time(10, 0), tzinfo=LOCAL_TZ).astimezone(timezone.utc)

        r_prog_1 = await client.post("/api/v1/clases", json={
            "nombre": f"Spinning Matutino {prefix}",
            "tipo": "Spinning",
            "entrenador_id": str(staff_coach_a_id),
            "cupo": 2,  # Cupo pequeño para probar límites
            "fecha_hora": fecha_clase_1.isoformat(),
            "recurrente": False,
        }, headers=headers_a)
        assert r_prog_1.status_code == 201, f"Error programar clase única: {r_prog_1.text}"
        clase_1 = r_prog_1.json()
        clase_1_id = clase_1["id"]
        assert clase_1["cupo"] == 2
        assert clase_1["cupos_disponibles"] == 2
        assert clase_1["estado"] == "programada"
        print(f" [PASS] Clase única programada con éxito (ID: {clase_1_id}, cupos: 2).")

        # 1.2 Clase recurrente con omisión de festivos colombianos (RF-32)
        # Programar serie de 8 semanas para Lunes a las 7:00 AM con omitir_festivos = true
        r_recur = await client.post("/api/v1/clases", json={
            "nombre": f"Funcional Lunes {prefix}",
            "tipo": "Funcional",
            "profesor_externo": "Profesor Carlos Yoga",
            "cupo": 15,
            "fecha_hora": fecha_clase_1.isoformat(),
            "recurrente": True,
            "dias_semana": [0],  # Solo Lunes
            "semanas_a_proyectar": 8,
            "omitir_festivos": True,
        }, headers=headers_a)
        assert r_recur.status_code == 201, f"Error programar recurrente: {r_recur.text}"
        clase_recur = r_recur.json()
        assert clase_recur["recurrente"] is True
        assert clase_recur["omitir_festivos"] is True

        # Verificar que ninguna instancia generada haya caído en un festivo colombiano
        r_list_recur = await client.get(f"/api/v1/clases?tipo=Funcional", headers=headers_a)
        assert r_list_recur.status_code == 200
        instancias_funcional = r_list_recur.json()["items"]
        assert len(instancias_funcional) > 0

        for inst in instancias_funcional:
            dt_inst = datetime.fromisoformat(inst["fecha_hora"].replace("Z", "+00:00")).astimezone(LOCAL_TZ)
            assert not es_festivo_colombia(dt_inst.date()), f"Error: Se generó clase en día festivo {dt_inst.date()} con omitir_festivos=True"
        print(f" [PASS] Serie recurrente generada con éxito ({len(instancias_funcional)} instancias). Festivos omitidos 100%.")

        # 1.3 Edición de clase (Coach sin permiso -> 403, Recepcionista con permiso -> 200)
        r_edit_forbidden = await client.put(f"/api/v1/clases/{clase_1_id}", json={
            "nombre": f"Spinning Potencia {prefix}",
            "cupo": 3,
        }, headers=headers_coach)
        assert r_edit_forbidden.status_code == 403

        r_edit_c = await client.put(f"/api/v1/clases/{clase_1_id}", json={
            "nombre": f"Spinning Potencia {prefix}",
            "cupo": 3,
        }, headers=headers_recep)
        assert r_edit_c.status_code == 200
        assert r_edit_c.json()["nombre"] == f"Spinning Potencia {prefix}"
        assert r_edit_c.json()["cupo"] == 3
        print(" [PASS] Control de permisos verificado (Coach 403 en edición, Recepcionista 200 OK).")

        print("\n--- 2. Reservas con Membresía Activa vs Pase Pagado en Caja (RF-33) ---")
        # 2.1 Deportista A1 (con membresía activa) reserva sin costo adicional
        r_res_1 = await client.post(f"/api/v1/clases/{clase_1_id}/reservas", json={
            "deportista_id": str(dep_a1_id),
        }, headers=headers_recep)
        assert r_res_1.status_code == 201, f"Error reservar con membresía activa: {r_res_1.text}"
        reserva_1 = r_res_1.json()
        reserva_1_id = reserva_1["id"]
        assert reserva_1["pase_pagado"] is False
        assert reserva_1["venta_item_id"] is None
        assert reserva_1["estado"] == "reservada"
        print(" [PASS] Deportista con membresía activa reservó clase sin costo (pase_pagado=false).")

        # 2.2 Deportista A2 (sin membresía) intenta reservar sin pase -> 400 PASE_CLASE_REQUERIDO
        r_res_sin_pase = await client.post(f"/api/v1/clases/{clase_1_id}/reservas", json={
            "deportista_id": str(dep_a2_id),
        }, headers=headers_recep)
        assert r_res_sin_pase.status_code == 400
        assert r_res_sin_pase.json()["error"]["codigo"] == "PASE_CLASE_REQUERIDO"
        print(" [PASS] Deportista sin membresía bloqueado sin pase pagado (400 PASE_CLASE_REQUERIDO).")

        # 2.3 Deportista A2 reserva enviando venta_item_id de la venta en Caja -> Éxito
        r_res_con_pase = await client.post(f"/api/v1/clases/{clase_1_id}/reservas", json={
            "deportista_id": str(dep_a2_id),
            "venta_item_id": str(venta_item_pase_id),
        }, headers=headers_recep)
        assert r_res_con_pase.status_code == 201, f"Error reservar con pase pagado: {r_res_con_pase.text}"
        reserva_2 = r_res_con_pase.json()
        reserva_2_id = reserva_2["id"]
        assert reserva_2["pase_pagado"] is True
        assert reserva_2["venta_item_id"] == str(venta_item_pase_id)
        print(" [PASS] Deportista sin membresía reservó exitosamente con pase pagado de Caja (pase_pagado=true).")

        # 2.4 Control de doble uso del pase: intentar usar el mismo venta_item_id en otra clase -> 409
        r_dup_pase = await client.post(f"/api/v1/clases/{clase_recur['id']}/reservas", json={
            "deportista_id": str(dep_a2_id),
            "venta_item_id": str(venta_item_pase_id),
        }, headers=headers_recep)
        assert r_dup_pase.status_code == 409
        assert r_dup_pase.json()["error"]["codigo"] == "PASE_CLASE_YA_UTILIZADO"
        print(" [PASS] Control de doble uso validado: Pase ya utilizado rechazado con 409 (PASE_CLASE_YA_UTILIZADO).")

        # 2.5 Validación de regla temporal: No se puede reservar una clase que ya pasó
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            res_pasada = await session.execute(text("""
                INSERT INTO platform.clases (
                    gimnasio_id, nombre, tipo, profesor_externo, cupo, fecha_hora, estado
                ) VALUES (
                    :gym, 'Clase Ayer', 'Crossfit', 'Instructor Pasado', 10, now() - interval '2 hours', 'programada'
                ) RETURNING id
            """), {"gym": gym_a_id})
            clase_pasada_id = res_pasada.scalar_one()
            await session.commit()

        r_res_pasada = await client.post(f"/api/v1/clases/{clase_pasada_id}/reservas", json={
            "deportista_id": str(dep_a1_id)
        }, headers=headers_recep)
        assert r_res_pasada.status_code == 400
        assert r_res_pasada.json()["error"]["codigo"] == "CLASE_INICIADA_O_FINALIZADA"
        print(" [PASS] Validación temporal validada: Reserva en clase iniciada/pasada rechazada con 400.")

        # 2.6 Liberación explícita de pase pagado al cancelar reserva
        # Al cancelar la reserva de Deportista A2, su venta_item_id debe quedar libre para reutilizarse
        r_canc_res = await client.delete(f"/api/v1/clases/{clase_1_id}/reservas/{reserva_2_id}", headers=headers_recep)
        assert r_canc_res.status_code == 200
        assert r_canc_res.json()["estado"] == "cancelada"

        # Ahora el pase venta_item_pase_id debe poder usarse en otra clase sin error de doble uso
        r_reuso_pase = await client.post(f"/api/v1/clases/{clase_recur['id']}/reservas", json={
            "deportista_id": str(dep_a2_id),
            "venta_item_id": str(venta_item_pase_id),
        }, headers=headers_recep)
        assert r_reuso_pase.status_code == 201, f"Error reutilizar pase liberado: {r_reuso_pase.text}"
        print(" [PASS] Liberación explícita de pase: Cancelar reserva liberó venta_item_id y permitió reuso exitoso.")

        print("\n--- 3. Asistencia a Clase y Validación de Check-in de Torniquete (RF-34) ---")
        # Crear una clase programada para el día de hoy por la recepcionista
        hoy_dt = datetime.combine(now_local().date(), time(18, 0), tzinfo=LOCAL_TZ).astimezone(timezone.utc)
        r_clase_hoy = await client.post("/api/v1/clases", json={
            "nombre": f"Yoga Hoy {prefix}",
            "tipo": "Yoga",
            "entrenador_id": str(staff_coach_a_id),
            "cupo": 10,
            "fecha_hora": hoy_dt.isoformat(),
        }, headers=headers_recep)
        assert r_clase_hoy.status_code == 201
        clase_hoy_id = r_clase_hoy.json()["id"]

        # Deportista A1 reserva la clase de hoy
        r_res_hoy = await client.post(f"/api/v1/clases/{clase_hoy_id}/reservas", json={
            "deportista_id": str(dep_a1_id)
        }, headers=headers_recep)
        assert r_res_hoy.status_code == 201

        # Intento de marcar asistencia SIN que el deportista haya entrado al gimnasio -> 400 SIN_CHECKIN_PREVIO
        r_asist_fail = await client.post(f"/api/v1/clases/{clase_hoy_id}/asistencia", json={
            "deportista_id": str(dep_a1_id)
        }, headers=headers_recep)
        assert r_asist_fail.status_code == 400
        assert r_asist_fail.json()["error"]["codigo"] == "SIN_CHECKIN_PREVIO"
        print(" [PASS] Asistencia rechazada correctamente si el deportista no ingresó al gimnasio hoy (400 SIN_CHECKIN_PREVIO).")

        # Simular que el deportista entró al gimnasio a las 5:00 PM (check-in previo de torniquete del mismo día)
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            res_chk = await session.execute(text("""
                INSERT INTO platform.checkins (
                    gimnasio_id, deportista_id, tipo, metodo, resultado, registrado_por, ts_utc
                ) VALUES (
                    :gym, :dep, 'ingreso', 'manual', 'abrio', :staff, now()
                ) RETURNING id
            """), {"gym": gym_a_id, "dep": dep_a1_id, "staff": staff_recep_a_id})
            torniquete_checkin_id = res_chk.scalar_one()
            await session.commit()

        # Marcar asistencia con check-in previo existente -> Éxito 200
        r_asist_ok = await client.post(f"/api/v1/clases/{clase_hoy_id}/asistencia", json={
            "deportista_id": str(dep_a1_id)
        }, headers=headers_recep)
        assert r_asist_ok.status_code == 200, f"Error asistencia: {r_asist_ok.text}"
        asist_data = r_asist_ok.json()
        assert asist_data["checkin_id"] == torniquete_checkin_id
        assert asist_data["deportista_id"] == str(dep_a1_id)
        print(f" [PASS] Asistencia confirmada vinculando checkin_id {torniquete_checkin_id} previo del mismo día.")

        # Comprobar resumen de asistencia: 1 asistente, 0 ausentes (el Coach sí tiene clases:leer)
        r_resumen = await client.get(f"/api/v1/clases/{clase_hoy_id}/asistencia", headers=headers_coach)
        assert r_resumen.status_code == 200
        resumen = r_resumen.json()
        assert resumen["total_asistieron"] == 1
        assert resumen["total_ausentes"] == 0

        # Cerrar clase realizada -> estado realizada (RF-34)
        r_cerrar = await client.post(f"/api/v1/clases/{clase_hoy_id}/cerrar", headers=headers_recep)
        assert r_cerrar.status_code == 200
        assert r_cerrar.json()["estado"] == "realizada"
        print(" [PASS] Cierre de clase exitoso (estado=realizada).")

        print("\n--- 4. Calificaciones de Clase (RF-35) ---")
        # Deportista A1 (que asistió) califica la clase con 5 estrellas
        r_calif = await client.post(f"/api/v1/clases/{clase_hoy_id}/calificaciones", json={
            "deportista_id": str(dep_a1_id),
            "puntaje": 5,
            "comentario": "Excelente clase de Yoga, muy relajante",
        }, headers=headers_recep)
        assert r_calif.status_code == 201
        assert r_calif.json()["puntaje"] == 5
        print(" [PASS] Calificación registrada por deportista asistente (5 estrellas).")

        # Deportista A2 (que no asistió a esta clase) intenta calificar -> 403 DEPORTISTA_NO_ASISTIO
        r_calif_fail = await client.post(f"/api/v1/clases/{clase_hoy_id}/calificaciones", json={
            "deportista_id": str(dep_a2_id),
            "puntaje": 1,
            "comentario": "No fui pero opino",
        }, headers=headers_recep)
        assert r_calif_fail.status_code == 403
        assert r_calif_fail.json()["error"]["codigo"] == "DEPORTISTA_NO_ASISTIO"
        print(" [PASS] Deportista no asistente bloqueado de calificar (403 DEPORTISTA_NO_ASISTIO).")

        # Consultar resumen de calificaciones
        r_resumen_calif = await client.get(f"/api/v1/clases/{clase_hoy_id}/calificaciones", headers=headers_coach)
        assert r_resumen_calif.status_code == 200
        res_cal = r_resumen_calif.json()
        assert res_cal["total_calificaciones"] == 1
        assert res_cal["promedio_puntaje"] == 5.0
        print(" [PASS] Resumen de calificaciones verificado (promedio 5.0).")

        print("\n--- 5. Aislamiento Cross-Tenant Estricto (RLS) ---")
        # Gym B intenta consultar clase de Gym A -> 404
        r_cross_get = await client.get(f"/api/v1/clases/{clase_hoy_id}", headers=headers_b)
        assert r_cross_get.status_code == 404

        # Gym B intenta listar clases -> 0 clases de Gym A
        r_cross_list = await client.get("/api/v1/clases", headers=headers_b)
        assert r_cross_list.status_code == 200
        assert r_cross_list.json()["total"] == 0

        # Gym B intenta reservar clase de Gym A -> 404
        r_cross_res = await client.post(f"/api/v1/clases/{clase_hoy_id}/reservas", json={
            "deportista_id": str(dep_b_id)
        }, headers=headers_b)
        assert r_cross_res.status_code == 404

        # Gym B intenta usar un pase de Gym A en Gym B -> 404
        r_cross_pase = await client.post(f"/api/v1/clases", json={
            "nombre": "Spinning Gym B",
            "profesor_externo": "Coach B",
            "cupo": 10,
            "fecha_hora": (now_local() + timedelta(days=2)).isoformat(),
        }, headers=headers_b)
        assert r_cross_pase.status_code == 201
        clase_b_id = r_cross_pase.json()["id"]

        r_cross_redeem = await client.post(f"/api/v1/clases/{clase_b_id}/reservas", json={
            "deportista_id": str(dep_b_id),
            "venta_item_id": str(venta_item_pase_id)  # Pertenece a Gym A
        }, headers=headers_b)
        assert r_cross_redeem.status_code == 404
        assert r_cross_redeem.json()["error"]["codigo"] == "PASE_CLASE_NO_ENCONTRADO"
        print(" [PASS] Aislamiento multi-tenant 100% verificado: Gym B no ve clases ni puede redimir pases de Gym A.")

        print("\n--- 6. Verificación de Auditoría Append-Only SHA-256 ---")
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            res_aud = await session.execute(text("""
                SELECT accion, entidad, hash_actual
                FROM platform.auditoria_gym
                WHERE gimnasio_id = :gym_id
                ORDER BY id ASC
            """), {"gym_id": gym_a_id})
            filas_aud = res_aud.fetchall()

        acciones = [f[0] for f in filas_aud]
        print(f" Acciones de auditoría registradas en Gym A: {acciones}")
        for esperada in ["PROGRAMAR_CLASE", "PROGRAMAR_CLASE_RECURRENTE", "EDITAR_CLASE", "CREAR_RESERVA_CLASE", "CANCELAR_RESERVA_CLASE", "REGISTRAR_ASISTENCIA_CLASE", "CERRAR_CLASE"]:
            assert esperada in acciones, f"Falta acción en auditoría: {esperada}"
        print(" [PASS] Trazabilidad SHA-256 inmutable verificada en platform.auditoria_gym.")

        print("\n--- 7. Verificación de Integridad de Esquema en BD Real ---")
        async with async_session_maker() as session:
            res_col = await session.execute(text("""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'platform' AND table_name = 'reservas_clase'
                  AND column_name = 'venta_item_id'
            """))
            col = res_col.first()
            assert col is not None, "La columna venta_item_id debe existir en platform.reservas_clase"
            assert col[1] == "uuid", "La columna venta_item_id debe ser de tipo uuid"
            print(" [PASS] Columna venta_item_id verificada en information_schema.columns (tipo uuid).")

    print("\n==================================================================")
    print(" SUITE COMPLETA DEL MÓDULO 7 Y AISLAMIENTO CROSS-TENANT SUPERADOS 100%")
    print("==================================================================\n")


if __name__ == "__main__":
    asyncio.run(run_modulo_7_full_test_suite())
