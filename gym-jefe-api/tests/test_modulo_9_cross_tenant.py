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


async def run_modulo_9_full_test_suite():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        print("=== INICIANDO SUITE COMPLETA MÓDULO 9: PERSONAL Y STAFF ===")

        # 1. SETUP DE TENANTS Y USUARIOS INICIALES (Gym A y Gym B)
        prefix = uuid.uuid4().hex[:6]
        gym_a_id = uuid.uuid4()
        gym_b_id = uuid.uuid4()
        staff_jefe_a_id = uuid.uuid4()
        staff_coach_a_id = uuid.uuid4()
        staff_recep_a_id = uuid.uuid4()
        staff_jefe_b_id = uuid.uuid4()
        staff_recep_b_id = uuid.uuid4()

        pwd_raw = "Password123!"
        pwd_hash = hash_password(pwd_raw)

        async with async_session_maker() as session:
            # Tenant A
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id_a, :nom_a, :sub_a, true)
            """), {"id_a": gym_a_id, "nom_a": f"Gym Pers A {prefix}", "sub_a": f"pers-a-{prefix}"})

            # Staff Gym A (Exactamente 1 Jefe activo)
            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Pers A', true)
            """), {"id": staff_jefe_a_id, "gym": gym_a_id, "mail": f"jefe_a_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'entrenador', :mail, :pwd, 'Coach Pers A', true)
            """), {"id": staff_coach_a_id, "gym": gym_a_id, "mail": f"coach_a_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recep Pers A', true)
            """), {"id": staff_recep_a_id, "gym": gym_a_id, "mail": f"recep_a_{prefix}@test.com", "pwd": pwd_hash})

            from app.modules.auth.service import AuthService
            await AuthService._seed_permisos_en_transaccion(session, gym_a_id)

            # Tenant B y Staff Gym B (Exactamente 1 Jefe activo)
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id_b, :nom_b, :sub_b, true)
            """), {"id_b": gym_b_id, "nom_b": f"Gym Pers B {prefix}", "sub_b": f"pers-b-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'jefe', :mail, :pwd, 'Jefe Pers B', true)
            """), {"id": staff_jefe_b_id, "gym": gym_b_id, "mail": f"jefe_b_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recep Pers B', true)
            """), {"id": staff_recep_b_id, "gym": gym_b_id, "mail": f"recep_b_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_b_id)
            await session.commit()

        # JWT Tokens
        token_jefe_a = create_access_token(subject=str(staff_jefe_a_id), gym_id=str(gym_a_id), role="jefe")
        token_coach_a = create_access_token(subject=str(staff_coach_a_id), gym_id=str(gym_a_id), role="entrenador")
        token_recep_a = create_access_token(subject=str(staff_recep_a_id), gym_id=str(gym_a_id), role="recepcionista")
        token_jefe_b = create_access_token(subject=str(staff_jefe_b_id), gym_id=str(gym_b_id), role="jefe")
        token_recep_b = create_access_token(subject=str(staff_recep_b_id), gym_id=str(gym_b_id), role="recepcionista")

        headers_jefe_a = {"Authorization": f"Bearer {token_jefe_a}"}
        headers_coach_a = {"Authorization": f"Bearer {token_coach_a}"}
        headers_recep_a = {"Authorization": f"Bearer {token_recep_a}"}
        headers_jefe_b = {"Authorization": f"Bearer {token_jefe_b}"}
        headers_recep_b = {"Authorization": f"Bearer {token_recep_b}"}

        print("--- [1/8] TEST CREACIÓN DE STAFF Y VALIDACIÓN DE CORREO ÚNICO ---")
        # Jefe A crea nuevo recepcionista
        email_nuevo_recep = f"nuevo_recep_{prefix}@gymos.co"
        res_crear = await client.post("/api/v1/personal", headers=headers_jefe_a, json={
            "nombre": "Carlos Recepción Nuevo",
            "correo": email_nuevo_recep,
            "password": "PasswordSegura123!",
            "rol": "recepcionista"
        })
        assert res_crear.status_code == 201, f"Error creando staff: {res_crear.text}"
        data_nuevo_recep = res_crear.json()
        nuevo_recep_id = data_nuevo_recep["id"]
        assert data_nuevo_recep["nombre"] == "Carlos Recepción Nuevo"
        assert data_nuevo_recep["rol"] == "recepcionista"
        assert data_nuevo_recep["activo"] is True
        assert data_nuevo_recep["version"] == 1

        # Jefe A intenta crear con el mismo correo pero en MAYÚSCULAS -> 400 CORREO_DUPLICADO
        res_dup = await client.post("/api/v1/personal", headers=headers_jefe_a, json={
            "nombre": "Clon Recepción",
            "correo": email_nuevo_recep.upper(),
            "password": "OtraPassword123!",
            "rol": "recepcionista"
        })
        assert res_dup.status_code == 400
        assert res_dup.json()["error"]["codigo"] == "CORREO_DUPLICADO"

        # Jefe A intenta registrar un 'jefe' directamente -> 422 Unprocessable Entity o 400 ROL_INVALIDO
        res_jefe_directo = await client.post("/api/v1/personal", headers=headers_jefe_a, json={
            "nombre": "Falso Jefe",
            "correo": f"falso_jefe_{prefix}@gymos.co",
            "password": "Password123!",
            "rol": "jefe"
        })
        assert res_jefe_directo.status_code in (400, 422)

        # Cross-Tenant: Jefe B PUEDE crear un usuario con el MISMO correo en Gym B
        res_crear_b = await client.post("/api/v1/personal", headers=headers_jefe_b, json={
            "nombre": "Carlos en Gym B",
            "correo": email_nuevo_recep,
            "password": "PasswordSegura123!",
            "rol": "recepcionista"
        })
        assert res_crear_b.status_code == 201, f"Error creando staff en Gym B con correo existente en Gym A: {res_crear_b.text}"

        print("--- [2/8] TEST AISLAMIENTO CROSS-TENANT ESTRICTO ---")
        # Jefe A no debe ver staff de Gym B
        res_list_a = await client.get("/api/v1/personal", headers=headers_jefe_a)
        assert res_list_a.status_code == 200
        items_a = res_list_a.json()["items"]
        gym_ids_in_a = {item["gimnasio_id"] for item in items_a}
        assert gym_ids_in_a == {str(gym_a_id)}

        # Jefe B intenta acceder a staff de Gym A -> 404
        res_cross_get = await client.get(f"/api/v1/personal/{nuevo_recep_id}", headers=headers_jefe_b)
        assert res_cross_get.status_code == 404
        assert res_cross_get.json()["error"]["codigo"] == "STAFF_NO_ENCONTRADO"

        res_cross_put = await client.put(f"/api/v1/personal/{nuevo_recep_id}", headers=headers_jefe_b, json={
            "nombre": "Hackeado por B",
            "correo": f"hack_{prefix}@gymos.co",
            "rol": "entrenador",
            "version": 1
        })
        assert res_cross_put.status_code == 404
        assert res_cross_put.json()["error"]["codigo"] == "STAFF_NO_ENCONTRADO"

        res_cross_patch = await client.patch(f"/api/v1/personal/{nuevo_recep_id}/estado", headers=headers_jefe_b, json={
            "activo": False,
            "motivo": "Ataque cross-tenant"
        })
        assert res_cross_patch.status_code == 404
        assert res_cross_patch.json()["error"]["codigo"] == "STAFF_NO_ENCONTRADO"

        res_cross_del = await client.delete(f"/api/v1/personal/{nuevo_recep_id}", headers=headers_jefe_b)
        assert res_cross_del.status_code == 404
        assert res_cross_del.json()["error"]["codigo"] == "STAFF_NO_ENCONTRADO"

        res_cross_trans = await client.post("/api/v1/personal/transferir-jefe", headers=headers_jefe_b, json={
            "nuevo_jefe_id": str(nuevo_recep_id),
            "nuevo_rol_antiguo_jefe": "entrenador",
            "password_confirmacion": pwd_raw
        })
        assert res_cross_trans.status_code == 404
        assert res_cross_trans.json()["error"]["codigo"] == "STAFF_NO_ENCONTRADO"

        print("--- [3/8] TEST RESTRICCIÓN DE AUTO-MODIFICACIÓN Y OPERACIONES SOBRE JEFE (CONFIRMACIONES 1 Y 2) ---")
        # 1. Jefe A intenta desactivar su propia cuenta -> 400 AUTO_MODIFICACION_NO_PERMITIDA
        res_self_patch = await client.patch(f"/api/v1/personal/{staff_jefe_a_id}/estado", headers=headers_jefe_a, json={
            "activo": False,
            "motivo": "Quiero auto-desactivarme"
        })
        assert res_self_patch.status_code == 400
        assert res_self_patch.json()["error"]["codigo"] == "AUTO_MODIFICACION_NO_PERMITIDA"

        # 2. Jefe A intenta auto-eliminarse -> 400 AUTO_MODIFICACION_NO_PERMITIDA
        res_self_del = await client.delete(f"/api/v1/personal/{staff_jefe_a_id}", headers=headers_jefe_a)
        assert res_self_del.status_code == 400
        assert res_self_del.json()["error"]["codigo"] == "AUTO_MODIFICACION_NO_PERMITIDA"

        # 3. Jefe A intenta editar los datos de su cuenta de Jefe mediante PUT /personal/{id} -> 400 OPERACION_INVALIDA_SOBRE_JEFE
        res_jefe_put = await client.put(f"/api/v1/personal/{staff_jefe_a_id}", headers=headers_jefe_a, json={
            "nombre": "Jefe Editado Ilegal",
            "correo": f"jefe_edit_{prefix}@test.com",
            "rol": "entrenador",
            "version": 1
        })
        assert res_jefe_put.status_code == 400
        assert res_jefe_put.json()["error"]["codigo"] == "OPERACION_INVALIDA_SOBRE_JEFE"

        print("--- [4/8] TEST CONCURRENCIA OPTIMISTA CON VERSION (RF-39) ---")
        # Obtener detalle actual del nuevo_recep
        res_detail = await client.get(f"/api/v1/personal/{nuevo_recep_id}", headers=headers_jefe_a)
        assert res_detail.status_code == 200
        recep_data = res_detail.json()
        current_version = recep_data["version"]

        # Intento de actualización con versión desactualizada (conflicto)
        res_conflict = await client.put(f"/api/v1/personal/{nuevo_recep_id}", headers=headers_jefe_a, json={
            "nombre": "Carlos Conflicto",
            "correo": recep_data["correo"],
            "rol": "recepcionista",
            "version": current_version + 99
        })
        assert res_conflict.status_code == 409
        assert res_conflict.json()["error"]["codigo"] == "CONFLICTO_CONCURRENCIA"

        # Actualización exitosa con la versión correcta
        res_upd_ok = await client.put(f"/api/v1/personal/{nuevo_recep_id}", headers=headers_jefe_a, json={
            "nombre": "Carlos Recepción Actualizado",
            "correo": recep_data["correo"],
            "rol": "entrenador",
            "version": current_version
        })
        assert res_upd_ok.status_code == 200
        upd_data = res_upd_ok.json()
        assert upd_data["nombre"] == "Carlos Recepción Actualizado"
        assert upd_data["rol"] == "entrenador"
        assert upd_data["version"] == current_version + 1

        print("--- [5/8] TEST INTEGRACIÓN REAL: CIERRE FORZADO DE TURNO AL DESACTIVAR RECEPCIONISTA (RF-39) ---")
        # Crear un nuevo recepcionista y abrirle un turno de caja real en la base de datos
        recep_con_turno_email = f"recep_turno_{prefix}@gymos.co"
        res_recep_turno = await client.post("/api/v1/personal", headers=headers_jefe_a, json={
            "nombre": "Recepcionista Con Turno",
            "correo": recep_con_turno_email,
            "password": "Password123!",
            "rol": "recepcionista"
        })
        assert res_recep_turno.status_code == 201
        staff_recep_turno_id = uuid.UUID(res_recep_turno.json()["id"])

        # Insertar un turno de caja abierto en platform.turnos_caja
        turno_id = uuid.uuid4()
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            await session.execute(text("""
                INSERT INTO platform.turnos_caja (
                    id, gimnasio_id, staff_id, base_inicial, estado, abierto_en, cierre_forzado
                ) VALUES (
                    :tid, :gym_id, :sid, 50000.00, 'abierto', now(), false
                )
            """), {"tid": turno_id, "gym_id": gym_a_id, "sid": staff_recep_turno_id})

            # Crear una sesión activa en platform.sesiones_staff
            await session.execute(text("""
                INSERT INTO platform.sesiones_staff (
                    id, gimnasio_id, staff_id, refresh_hash, expira_en, created_at
                ) VALUES (
                    gen_random_uuid(), :gym_id, :sid, 'test_refresh_hash_123', now() + interval '7 days', now()
                )
            """), {"gym_id": gym_a_id, "sid": staff_recep_turno_id})
            await session.commit()

        # Jefe A desactiva a este recepcionista -> Debe disparar CajaService.cerrar_turno_forzado
        res_desactivar = await client.patch(f"/api/v1/personal/{staff_recep_turno_id}/estado", headers=headers_jefe_a, json={
            "activo": False,
            "motivo": "Salida no programada y turno pendiente"
        })
        assert res_desactivar.status_code == 200, f"Error desactivando recepcionista con turno: {res_desactivar.text}"
        desact_data = res_desactivar.json()
        assert desact_data["activo"] is False
        assert desact_data["turno_cerrado_forzado"] is True
        assert desact_data["turno_id_cerrado"] == str(turno_id)

        # Verificación directa en base de datos de PostgreSQL
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
            
            # 1. Turno de caja cerrado y cierre_forzado = true
            q_chk_turno = text("SELECT estado, cierre_forzado, cerrado_en FROM platform.turnos_caja WHERE id = :tid")
            res_t = await session.execute(q_chk_turno, {"tid": turno_id})
            row_t = res_t.mappings().first()
            assert row_t["estado"] == "cerrado", f"El turno debería estar cerrado, estado: {row_t['estado']}"
            assert row_t["cierre_forzado"] is True, "cierre_forzado debe ser True"
            assert row_t["cerrado_en"] is not None, "cerrado_en no debe ser None"

            # 2. Sesiones activas revocadas
            q_chk_ses = text("SELECT count(*) FROM platform.sesiones_staff WHERE staff_id = :sid")
            count_ses = (await session.execute(q_chk_ses, {"sid": staff_recep_turno_id})).scalar()
            assert count_ses == 0, "Todas las sesiones activas del usuario desactivado debieron ser revocadas"

            # 3. Auditoría registrada en platform.auditoria_gym
            q_chk_audit = text("""
                SELECT accion, entidad, entidad_id 
                FROM platform.auditoria_gym 
                WHERE gimnasio_id = :gym_id AND entidad_id = :sid
                ORDER BY id DESC
            """)
            audit_res = await session.execute(q_chk_audit, {"gym_id": gym_a_id, "sid": str(staff_recep_turno_id)})
            audit_actions = [r["accion"] for r in audit_res.mappings().all()]
            assert "CAMBIAR_ESTADO_STAFF" in audit_actions, f"Auditoría no encontrada: {audit_actions}"

        # 4. Token del usuario desactivado es rechazado inmediatamente
        token_recep_inactivo = create_access_token(subject=str(staff_recep_turno_id), gym_id=str(gym_a_id), role="recepcionista")
        res_inactivo_call = await client.get("/api/v1/personal", headers={"Authorization": f"Bearer {token_recep_inactivo}"})
        assert res_inactivo_call.status_code == 403
        assert res_inactivo_call.json()["error"]["codigo"] == "USUARIO_INACTIVO"

        print("--- [6/8] TEST TRANSFERENCIA DEL ROL DE JEFE Y RESPETO DE ux_un_jefe_por_gym (RF-40) ---")
        # Crear un candidato activo a Jefe en Gym A
        res_cand = await client.post("/api/v1/personal", headers=headers_jefe_a, json={
            "nombre": "Futuro Jefe Gym A",
            "correo": f"candidato_jefe_{prefix}@gymos.co",
            "password": "Password123!",
            "rol": "entrenador"
        })
        assert res_cand.status_code == 201
        candidato_id = uuid.UUID(res_cand.json()["id"])

        # 1. Fallo: Contraseña incorrecta
        res_trans_bad_pwd = await client.post("/api/v1/personal/transferir-jefe", headers=headers_jefe_a, json={
            "nuevo_jefe_id": str(candidato_id),
            "nuevo_rol_antiguo_jefe": "entrenador",
            "password_confirmacion": "PasswordEquivocada!"
        })
        assert res_trans_bad_pwd.status_code == 400
        assert res_trans_bad_pwd.json()["error"]["codigo"] == "PASSWORD_INCORRECTA"

        # 2. Fallo: Intentar transferirse a sí mismo
        res_trans_self = await client.post("/api/v1/personal/transferir-jefe", headers=headers_jefe_a, json={
            "nuevo_jefe_id": str(staff_jefe_a_id),
            "nuevo_rol_antiguo_jefe": "entrenador",
            "password_confirmacion": pwd_raw
        })
        assert res_trans_self.status_code == 400
        assert res_trans_self.json()["error"]["codigo"] == "TRANSFERENCIA_INVALIDA"

        # 3. Transferencia exitosa con orden correcto (antiguo jefe degrada a entrenador, nuevo jefe asciende)
        res_trans_ok = await client.post("/api/v1/personal/transferir-jefe", headers=headers_jefe_a, json={
            "nuevo_jefe_id": str(candidato_id),
            "nuevo_rol_antiguo_jefe": "entrenador",
            "password_confirmacion": pwd_raw
        })
        assert res_trans_ok.status_code == 200, f"Error en transferencia: {res_trans_ok.text}"
        trans_data = res_trans_ok.json()
        assert trans_data["antiguo_jefe_id"] == str(staff_jefe_a_id)
        assert trans_data["antiguo_jefe_nuevo_rol"] == "entrenador"
        assert trans_data["nuevo_jefe_id"] == str(candidato_id)

        # 4. Validar en base de datos el respeto absoluto de ux_un_jefe_por_gym
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})

            # Comprobar que en Gym A hay EXACTAMENTE 1 Jefe activo
            q_jefes_gym_a = text("""
                SELECT id, nombre, rol 
                FROM platform.staff 
                WHERE gimnasio_id = :gym_id AND rol = 'jefe' AND deleted_at IS NULL
            """)
            jefes_a = (await session.execute(q_jefes_gym_a, {"gym_id": gym_a_id})).mappings().all()
            assert len(jefes_a) == 1, f"Debe haber exactamente 1 Jefe activo por gimnasio, encontrados: {len(jefes_a)}"
            assert jefes_a[0]["id"] == candidato_id
            assert jefes_a[0]["nombre"] == "Futuro Jefe Gym A"

            # Comprobar que el antiguo jefe ahora es entrenador
            q_antiguo = text("SELECT rol FROM platform.staff WHERE id = :id")
            rol_antiguo = (await session.execute(q_antiguo, {"id": staff_jefe_a_id})).scalar()
            assert rol_antiguo == "entrenador"

            # Comprobar auditoría de la transferencia
            q_audit_trans = text("""
                SELECT accion, detalle 
                FROM platform.auditoria_gym 
                WHERE gimnasio_id = :gym_id AND accion = 'TRANSFERENCIA_ROL_JEFE'
            """)
            audit_trans = (await session.execute(q_audit_trans, {"gym_id": gym_a_id})).mappings().first()
            assert audit_trans is not None
            assert audit_trans["detalle"]["antiguo_jefe_id"] == str(staff_jefe_a_id)
            assert audit_trans["detalle"]["nuevo_jefe_id"] == str(candidato_id)

        # 5. El nuevo Jefe puede autenticarse y ejecutar acciones de Jefe
        token_nuevo_jefe = create_access_token(subject=str(candidato_id), gym_id=str(gym_a_id), role="jefe")
        res_test_nuevo_jefe = await client.get("/api/v1/personal", headers={"Authorization": f"Bearer {token_nuevo_jefe}"})
        assert res_test_nuevo_jefe.status_code == 200

        print("--- [7/8] TEST ELIMINACIÓN LÓGICA (SOFT-DELETE) DE STAFF ---")
        # Crear recepcionista para eliminar
        res_del_staff = await client.post("/api/v1/personal", headers={"Authorization": f"Bearer {token_nuevo_jefe}"}, json={
            "nombre": "Staff Para Eliminar",
            "correo": f"para_eliminar_{prefix}@gymos.co",
            "password": "Password123!",
            "rol": "recepcionista"
        })
        assert res_del_staff.status_code == 201
        del_staff_id = res_del_staff.json()["id"]

        # Eliminar
        res_del_ok = await client.delete(f"/api/v1/personal/{del_staff_id}", headers={"Authorization": f"Bearer {token_nuevo_jefe}"})
        assert res_del_ok.status_code == 200
        assert res_del_ok.json()["mensaje"] == "Miembro del personal eliminado correctamente"

        # Intentar obtener el eliminado -> 404
        res_get_del = await client.get(f"/api/v1/personal/{del_staff_id}", headers={"Authorization": f"Bearer {token_nuevo_jefe}"})
        assert res_get_del.status_code == 404

        # Intentar eliminar al Jefe actual (candidato_id) -> 400 AUTO_MODIFICACION_NO_PERMITIDA
        res_del_curr_jefe = await client.delete(f"/api/v1/personal/{candidato_id}", headers={"Authorization": f"Bearer {token_nuevo_jefe}"})
        assert res_del_curr_jefe.status_code == 400
        assert res_del_curr_jefe.json()["error"]["codigo"] == "AUTO_MODIFICACION_NO_PERMITIDA"

        print("--- [8/8] TEST RECHAZO RBAC EN ROLES SUBORDINADOS ---")
        # Recepcionista y entrenador no tienen permiso para gestionar personal por defecto
        res_coach_forbidden = await client.post("/api/v1/personal", headers=headers_coach_a, json={
            "nombre": "Ilegal por Entrenador",
            "correo": f"ilegal_{prefix}@gymos.co",
            "password": "Password123!",
            "rol": "recepcionista"
        })
        assert res_coach_forbidden.status_code == 403
        assert res_coach_forbidden.json()["error"]["codigo"] == "PERMISO_DENEGADO"

        res_recep_forbidden = await client.get("/api/v1/personal", headers=headers_recep_a)
        assert res_recep_forbidden.status_code == 403
        assert res_recep_forbidden.json()["error"]["codigo"] == "PERMISO_DENEGADO"

        # Recepcionista no puede llamar a transferir-jefe
        res_trans_forbidden = await client.post("/api/v1/personal/transferir-jefe", headers=headers_recep_a, json={
            "nuevo_jefe_id": str(staff_recep_a_id),
            "nuevo_rol_antiguo_jefe": "entrenador",
            "password_confirmacion": pwd_raw
        })
        assert res_trans_forbidden.status_code == 403
        assert res_trans_forbidden.json()["error"]["codigo"] == "ROL_NO_AUTORIZADO"

        print("=== TODAS LAS PRUEBAS DEL MÓDULO 9 (PERSONAL Y STAFF) PASARON EXITOSAMENTE ===")


if __name__ == "__main__":
    asyncio.run(run_modulo_9_full_test_suite())
