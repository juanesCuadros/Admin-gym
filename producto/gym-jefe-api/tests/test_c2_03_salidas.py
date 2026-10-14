import pytest
from datetime import datetime, timedelta
from uuid import uuid4
from httpx import AsyncClient
from sqlalchemy import text
from zoneinfo import ZoneInfo

from app.core.database import async_session_maker
from app.core.timezone import now_local, today_local
from tests.conftest import Fabrica, login


@pytest.mark.asyncio
async def test_registrar_salida_y_permanencia_ca1(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA1: Un cliente que entró hace 90 minutos y sale registra su salida con ~90 minutos de permanencia.
    Verifica también auditoría y respuesta según contrato 2.2.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    dep_id = uuid4()
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, 'CC', '1001001', 'Deportista Salida CA1', true, now(), true)
            """),
            {"id": dep_id, "g": gym.id},
        )
        # Ingreso hace 90 minutos
        res_ck = await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '90 minutes')
                RETURNING id
            """),
            {"g": gym.id, "dep": dep_id},
        )
        checkin_id = res_ck.scalar_one()
        await s.commit()

    # Registrar salida
    r_salida = await cliente.post(
        "/api/v1/control-ingreso/salida",
        json={"deportista_id": str(dep_id)},
        headers=headers,
    )
    assert r_salida.status_code == 200, r_salida.text
    data = r_salida.json()
    assert data["checkin_id"] == checkin_id
    assert data["deportista_id"] == str(dep_id)
    assert data["deportista_nombre"] == "Deportista Salida CA1"
    assert data["salida_ts"] is not None
    # 90 minutos (con tolerancia de 1 minuto)
    assert 89 <= data["permanencia_minutos"] <= 91

    # Verificar BD y auditoría
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        ck_db = (await s.execute(
            text("SELECT salida_ts, salida_registrado_por FROM platform.checkins WHERE id = :id"),
            {"id": checkin_id}
        )).mappings().first()
        assert ck_db["salida_ts"] is not None
        assert ck_db["salida_registrado_por"] is not None

        audit_db = (await s.execute(
            text("""
                SELECT accion, entidad, entidad_id
                FROM platform.auditoria_gym
                WHERE gimnasio_id = :g AND entidad_id = :ent_id AND accion = 'REGISTRAR_SALIDA'
            """),
            {"g": gym.id, "ent_id": str(checkin_id)}
        )).mappings().first()
        assert audit_db is not None
        assert audit_db["accion"] == "REGISTRAR_SALIDA"


@pytest.mark.asyncio
async def test_salida_sin_ingreso_abierto_409_ca2(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA2: Intentar registrar la salida de alguien sin ingreso permitido hoy responde 409 SIN_INGRESO_ABIERTO.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    dep_id = uuid4()
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, 'CC', '1001002', 'Deportista Sin Ingreso', true, now(), true)
            """),
            {"id": dep_id, "g": gym.id},
        )
        await s.commit()

    r = await cliente.post(
        "/api/v1/control-ingreso/salida",
        json={"deportista_id": str(dep_id)},
        headers=headers,
    )
    assert r.status_code == 409
    body = r.json()
    assert body["error"]["codigo"] == "SIN_INGRESO_ABIERTO"


@pytest.mark.asyncio
async def test_segunda_salida_consecutiva_409(cliente: AsyncClient, fabrica: Fabrica):
    """
    Un ingreso solo tiene una salida. Una segunda llamada responde 409.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    dep_id = uuid4()
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, 'CC', '1001003', 'Deportista Doble Salida', true, now(), true)
            """),
            {"id": dep_id, "g": gym.id},
        )
        await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '30 minutes')
            """),
            {"g": gym.id, "dep": dep_id},
        )
        await s.commit()

    # Primera salida: éxito
    r1 = await cliente.post("/api/v1/control-ingreso/salida", json={"deportista_id": str(dep_id)}, headers=headers)
    assert r1.status_code == 200

    # Segunda salida: 409
    r2 = await cliente.post("/api/v1/control-ingreso/salida", json={"deportista_id": str(dep_id)}, headers=headers)
    assert r2.status_code == 409
    assert r2.json()["error"]["codigo"] == "SIN_INGRESO_ABIERTO"


@pytest.mark.asyncio
async def test_quien_esta_adentro_excluye_ayer_ca3(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA3: Un ingreso de ayer sin salida no aparece en "quién está adentro" hoy.
    Solo aparecen los ingresos permitidos de hoy sin salida registrada.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    dep_hoy_id = uuid4()
    dep_ayer_id = uuid4()
    dep_salio_id = uuid4()

    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        # Crear deportistas
        for d_id, doc, nom in [
            (dep_hoy_id, "1001004", "Deportista Adentro Hoy"),
            (dep_ayer_id, "1001005", "Deportista Ayer"),
            (dep_salio_id, "1001006", "Deportista Salio Hoy"),
        ]:
            await s.execute(
                text("""
                    INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                    VALUES (:id, :g, 'CC', :doc, :nom, true, now(), true)
                """),
                {"id": d_id, "g": gym.id, "doc": doc, "nom": nom},
            )

        # 1. Ingreso de hoy sin salida (debe aparecer)
        await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '45 minutes')
            """),
            {"g": gym.id, "dep": dep_hoy_id},
        )
        # 2. Ingreso de ayer sin salida (NO debe aparecer)
        await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '30 hours')
            """),
            {"g": gym.id, "dep": dep_ayer_id},
        )
        # 3. Ingreso de hoy que ya salió (NO debe aparecer)
        await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc, salida_ts)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '60 minutes', now() - interval '10 minutes')
            """),
            {"g": gym.id, "dep": dep_salio_id},
        )
        await s.commit()

    r = await cliente.get("/api/v1/control-ingreso/adentro", headers=headers)
    assert r.status_code == 200
    data = r.json()
    items = data["items"]
    ids_adentro = [item["deportista_id"] for item in items]

    assert str(dep_hoy_id) in ids_adentro
    assert str(dep_ayer_id) not in ids_adentro
    assert str(dep_salio_id) not in ids_adentro

    item_hoy = next(i for i in items if i["deportista_id"] == str(dep_hoy_id))
    assert 44 <= item_hoy["minutos_adentro"] <= 46


@pytest.mark.asyncio
async def test_salida_ingreso_nocturno_24h_ca4(cliente: AsyncClient, fabrica: Fabrica):
    """
    CA4: Con ingreso a las 23:50 y salida a las 00:10 (ventana de 24h), la salida
    se registra exitosamente porque corresponde al ingreso abierto más reciente.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    dep_id = uuid4()
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, 'CC', '1001007', 'Deportista Nocturno', true, now(), true)
            """),
            {"id": dep_id, "g": gym.id},
        )
        # Ingreso hace 3 horas (cruzando medianoche si fuera el caso, siempre dentro de 24h)
        await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '180 minutes')
            """),
            {"g": gym.id, "dep": dep_id},
        )
        await s.commit()

    r = await cliente.post(
        "/api/v1/control-ingreso/salida",
        json={"deportista_id": str(dep_id)},
        headers=headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert 179 <= data["permanencia_minutos"] <= 181


@pytest.mark.asyncio
async def test_ingresos_hoy_incluye_salidas_y_adentro_ahora(cliente: AsyncClient, fabrica: Fabrica):
    """
    Verifica que GET /control-ingreso/ingresos-hoy devuelva adentro_ahora y datos de permanencia.
    """
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    dep_id = uuid4()
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, 'CC', '1001008', 'Deportista Metricas', true, now(), true)
            """),
            {"id": dep_id, "g": gym.id},
        )
        # Ingreso hoy
        await s.execute(
            text("""
                INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                VALUES (:g, :dep, 'ingreso', 'manual', 'abrio', now() - interval '20 minutes')
            """),
            {"g": gym.id, "dep": dep_id},
        )
        await s.commit()

    # Consultar ingresos hoy antes de salida
    r1 = await cliente.get("/api/v1/control-ingreso/ingresos-hoy", headers=headers)
    assert r1.status_code == 200
    data1 = r1.json()
    assert "adentro_ahora" in data1["resumen"]
    assert data1["resumen"]["adentro_ahora"] >= 1

    # Registrar salida
    r_salida = await cliente.post(
        "/api/v1/control-ingreso/salida",
        json={"deportista_id": str(dep_id)},
        headers=headers,
    )
    assert r_salida.status_code == 200

    # Consultar ingresos hoy después de salida
    r2 = await cliente.get("/api/v1/control-ingreso/ingresos-hoy", headers=headers)
    assert r2.status_code == 200
    data2 = r2.json()
    item_dep = next(i for i in data2["items"] if i["deportista_id"] == str(dep_id))
    assert item_dep["salida_ts"] is not None
    assert item_dep["permanencia_minutos"] is not None
