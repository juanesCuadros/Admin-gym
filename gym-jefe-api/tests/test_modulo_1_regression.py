import asyncio
import os
import sys
from datetime import date, timedelta
from uuid import uuid4

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text
from app.core.database import async_session_maker
from app.core.timezone import today_local
from app.modules.control_ingreso.service import ControlIngresoService


async def run_modulo_1_regression_suite():
    print("\n==================================================================")
    print("SUITE DE REGRESIÓN: MÓDULO 1 CONTROL DE INGRESO")
    print("Verificación de los 8 estados derivados y deduplicación en PostgreSQL real")
    print("==================================================================")

    gym_id = uuid4()
    staff_id = uuid4()
    subdominio = f"gym-mod1-{uuid4().hex[:6]}"
    hoy = today_local()

    # IDs de los 8 casos de prueba
    dep_inactivo_id = uuid4()
    dep_sin_membresia_id = uuid4()
    dep_cancelada_id = uuid4()
    dep_congelado_id = uuid4()
    dep_por_vencer_id = uuid4()
    dep_activo_id = uuid4()
    dep_mora_id = uuid4()
    dep_vencido_id = uuid4()

    plan_id = uuid4()

    async with async_session_maker() as session:
        # Configurar tenant con gracia 3 días y umbral por vencer 5 días
        await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
        await session.execute(text("""
            INSERT INTO platform.tenant (id, nombre, subdominio, dias_gracia_mora, dias_umbral_por_vencer, activo)
            VALUES (:id, 'Gym Modulo 1 Test', :sub, 3, 5, true)
        """), {"id": gym_id, "sub": subdominio})

        await session.execute(text("""
            INSERT INTO platform.staff (id, gimnasio_id, nombre, correo, hash_password, rol, activo)
            VALUES (:id, :g_id, 'Staff Control Ingreso', 'staff_mod1@gym.com', 'dummy_hash', 'recepcionista', true)
        """), {"id": staff_id, "g_id": gym_id})

        await session.execute(text("""
            INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo)
            VALUES (:id, :g_id, 'Plan Mensual Test', 80000.0, 30, 'individual')
        """), {"id": plan_id, "g_id": gym_id})

        # 1. Deportista Inactivo (activo = false)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-INACTIVO', 'Deportista Inactivo', false, true, now())
        """), {"id": dep_inactivo_id, "g_id": gym_id})

        # 2. Deportista Sin Membresía (activo = true, 0 membresías)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-SIN-MEMB', 'Deportista Sin Membresia', true, true, now())
        """), {"id": dep_sin_membresia_id, "g_id": gym_id})

        # 3. Deportista Membresía Cancelada (cancelada = true)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-CANCELADA', 'Deportista Membresia Cancelada', true, true, now())
        """), {"id": dep_cancelada_id, "g_id": gym_id})
        await session.execute(text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
            VALUES (:id, :g_id, :d_id, :p_id, :fini, :fvenc, true)
        """), {"id": uuid4(), "g_id": gym_id, "d_id": dep_cancelada_id, "p_id": plan_id, "fini": hoy - timedelta(days=10), "fvenc": hoy + timedelta(days=20)})

        # 4. Deportista Congelado (membresía activa + congelamiento abierto fecha_fin IS NULL)
        memb_cong_id = uuid4()
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-CONGELADO', 'Deportista Congelado', true, true, now())
        """), {"id": dep_congelado_id, "g_id": gym_id})
        await session.execute(text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
            VALUES (:id, :g_id, :d_id, :p_id, :fini, :fvenc, false)
        """), {"id": memb_cong_id, "g_id": gym_id, "d_id": dep_congelado_id, "p_id": plan_id, "fini": hoy - timedelta(days=10), "fvenc": hoy + timedelta(days=20)})
        await session.execute(text("""
            INSERT INTO platform.congelamientos (id, gimnasio_id, membresia_id, fecha_inicio, fecha_fin)
            VALUES (:id, :g_id, :m_id, :fini, NULL)
        """), {"id": uuid4(), "g_id": gym_id, "m_id": memb_cong_id, "fini": hoy - timedelta(days=2)})

        # 5. Deportista Por Vencer (vence en 2 días <= umbral 5)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-POR-VENCER', 'Deportista Por Vencer', true, true, now())
        """), {"id": dep_por_vencer_id, "g_id": gym_id})
        await session.execute(text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
            VALUES (:id, :g_id, :d_id, :p_id, :fini, :fvenc, false)
        """), {"id": uuid4(), "g_id": gym_id, "d_id": dep_por_vencer_id, "p_id": plan_id, "fini": hoy - timedelta(days=28), "fvenc": hoy + timedelta(days=2)})

        # 6. Deportista Activo (vence en 25 días > umbral 5)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-ACTIVO', 'Deportista Activo', true, true, now())
        """), {"id": dep_activo_id, "g_id": gym_id})
        await session.execute(text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
            VALUES (:id, :g_id, :d_id, :p_id, :fini, :fvenc, false)
        """), {"id": uuid4(), "g_id": gym_id, "d_id": dep_activo_id, "p_id": plan_id, "fini": hoy - timedelta(days=5), "fvenc": hoy + timedelta(days=25)})

        # 7. Deportista en Mora (venció hace 2 días <= gracia 3)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-MORA', 'Deportista En Mora', true, true, now())
        """), {"id": dep_mora_id, "g_id": gym_id})
        await session.execute(text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
            VALUES (:id, :g_id, :d_id, :p_id, :fini, :fvenc, false)
        """), {"id": uuid4(), "g_id": gym_id, "d_id": dep_mora_id, "p_id": plan_id, "fini": hoy - timedelta(days=32), "fvenc": hoy - timedelta(days=2)})

        # 8. Deportista Vencido (venció hace 10 días > gracia 3)
        await session.execute(text("""
            INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, activo, consentimiento_1581, consentimiento_fecha)
            VALUES (:id, :g_id, 'CC-VENCIDO', 'Deportista Vencido', true, true, now())
        """), {"id": dep_vencido_id, "g_id": gym_id})
        await session.execute(text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada)
            VALUES (:id, :g_id, :d_id, :p_id, :fini, :fvenc, false)
        """), {"id": uuid4(), "g_id": gym_id, "d_id": dep_vencido_id, "p_id": plan_id, "fini": hoy - timedelta(days=40), "fvenc": hoy - timedelta(days=10)})

        await session.commit()

    # Ejecución de validaciones de negocio en sesiones independientes
    casos = [
        ("1. Inactivo", dep_inactivo_id, "inactivo", "negado", False),
        ("2. Sin Membresía", dep_sin_membresia_id, "sin_membresia", "negado", False),
        ("3. Cancelada", dep_cancelada_id, "cancelada", "negado", False),
        ("4. Congelado", dep_congelado_id, "congelado", "negado", False),
        ("5. Por Vencer", dep_por_vencer_id, "por_vencer", "abrio", True),
        ("6. Activo", dep_activo_id, "activo", "abrio", True),
        ("7. Mora", dep_mora_id, "mora", "alerta_mora", True),
        ("8. Vencido", dep_vencido_id, "vencido", "negado", False),
    ]

    print("\n--- Verificando los 8 estados derivados en Control de Ingreso ---")
    for nombre_caso, dep_id, exp_estado, exp_resultado, exp_comando in casos:
        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            res = await ControlIngresoService.evaluar_y_procesar_checkin(
                session=session,
                gym_id=gym_id,
                staff_id=staff_id,
                deportista_id=dep_id,
                metodo="manual"
            )
            await session.commit()
            assert res.deportista.estado_calculado == exp_estado, (
                f"[{nombre_caso}] Estado esperado '{exp_estado}', obtenido '{res.deportista.estado_calculado}'"
            )
            assert res.resultado == exp_resultado, (
                f"[{nombre_caso}] Resultado esperado '{exp_resultado}', obtenido '{res.resultado}'"
            )
            assert res.comando_torniquete == exp_comando, (
                f"[{nombre_caso}] Torniquete esperado {exp_comando}, obtenido {res.comando_torniquete}"
            )
            print(f" [PASS] {nombre_caso}: estado='{res.deportista.estado_calculado}', resultado='{res.resultado}', torniquete={res.comando_torniquete}")

    # 9. Verificación de Deduplicación de 3 segundos
    print("\n--- Verificando Deduplicación estricta de 3 segundos ---")
    async with async_session_maker() as session:
        await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
        # Segundo check-in inmediato del deportista activo
        res_dup = await ControlIngresoService.evaluar_y_procesar_checkin(
            session=session,
            gym_id=gym_id,
            staff_id=staff_id,
            deportista_id=dep_activo_id,
            metodo="manual"
        )
        assert res_dup.relectura_ignorada is True, "Fallo: la relectura inmediata no fue ignorada"
        assert res_dup.comando_torniquete is False, "Fallo: relectura no debe abrir torniquete"
        print(" [PASS] Deduplicación: Relectura en ventana de 3s ignorada exitosamente (comando_torniquete=False).")

    print("\n==================================================================")
    print(" RESULTADO REGRESIÓN: 9/9 PRUEBAS DEL MÓDULO 1 SUPERADAS AL 100%")
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(run_modulo_1_regression_suite())
