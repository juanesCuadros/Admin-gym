"""Escritorio · migración 070: aislamiento por gimnasio y marcas de sincronización."""
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.database import async_session_maker
from app.core.security import hash_token
from tests.conftest import Fabrica

pytestmark = pytest.mark.asyncio

TABLAS_NUEVAS = ["estaciones", "sync_intentos_activacion", "sync_operaciones", "sync_revisiones", "sync_eliminados"]


async def _sql(gym_id, consulta: str, params: dict | None = None):
    """Ejecuta como la aplicación (rol gymos_platform), con o sin gimnasio fijado."""
    async with async_session_maker() as s:
        if gym_id is not None:
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym_id)})
        res = await s.execute(text(consulta), params or {})
        filas = res.mappings().all() if res.returns_rows else []
        await s.commit()
        return filas


async def _crear_estacion(gym_id, nombre="Recepción", token: str | None = None):
    filas = await _sql(
        gym_id,
        "INSERT INTO platform.estaciones (gimnasio_id, nombre, device_token_hash) VALUES (:g, :n, :t) RETURNING id",
        {"g": gym_id, "n": nombre, "t": hash_token(token) if token else None},
    )
    return filas[0]["id"]


async def test_sin_gimnasio_fijado_no_se_ve_ninguna_estacion(fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    await _crear_estacion(gym.id)
    for tabla in TABLAS_NUEVAS:
        assert await _sql(None, f"SELECT 1 FROM platform.{tabla}") == [], tabla


async def test_un_gimnasio_no_ve_ni_escribe_estaciones_de_otro(fabrica: Fabrica):
    a = await fabrica.crear_gimnasio()
    b = await fabrica.crear_gimnasio()
    estacion_a = await _crear_estacion(a.id)

    assert await _sql(b.id, "SELECT 1 FROM platform.estaciones") == []
    assert len(await _sql(a.id, "SELECT 1 FROM platform.estaciones")) == 1

    # Desde B no se puede crear una estación a nombre de A ni tocar la de A.
    with pytest.raises(DBAPIError):
        await _sql(b.id, "INSERT INTO platform.estaciones (gimnasio_id, nombre) VALUES (:g, 'Intrusa')", {"g": a.id})
    await _sql(b.id, "UPDATE platform.estaciones SET nombre = 'Cambiada' WHERE id = :id", {"id": estacion_a})
    assert (await _sql(a.id, "SELECT nombre FROM platform.estaciones"))[0]["nombre"] == "Recepción"


async def test_el_token_de_la_estacion_resuelve_solo_su_gimnasio(fabrica: Fabrica):
    a = await fabrica.crear_gimnasio()
    token = f"token-{uuid4().hex}"
    await _crear_estacion(a.id, token=token)
    filas = await _sql(None, "SELECT platform.gimnasio_id_por_device_token(:h) AS g", {"h": hash_token(token)})
    assert filas[0]["g"] == a.id
    filas = await _sql(None, "SELECT platform.gimnasio_id_por_device_token(:h) AS g", {"h": hash_token("otro")})
    assert filas[0]["g"] is None


async def test_cada_cambio_renueva_la_marca_de_sincronizacion(fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    plan_id = uuid4()
    await _sql(
        gym.id,
        "INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:id, :g, 'Mensual', 80000, 30, 'individual')",
        {"id": plan_id, "g": gym.id},
    )
    antes = (await _sql(gym.id, "SELECT sync_xid FROM platform.planes WHERE id = :id", {"id": plan_id}))[0]["sync_xid"]
    await _sql(gym.id, "UPDATE platform.planes SET precio = 90000 WHERE id = :id", {"id": plan_id})
    despues = (await _sql(gym.id, "SELECT sync_xid FROM platform.planes WHERE id = :id", {"id": plan_id}))[0]["sync_xid"]
    assert despues > antes


async def test_un_borrado_fisico_queda_registrado_para_las_estaciones(fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    plan_id = uuid4()
    await _sql(
        gym.id,
        "INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:id, :g, 'Borrable', 1000, 1, 'individual')",
        {"id": plan_id, "g": gym.id},
    )
    await _sql(gym.id, "DELETE FROM platform.planes WHERE id = :id", {"id": plan_id})
    filas = await _sql(gym.id, "SELECT tabla, registro_id FROM platform.sync_eliminados")
    assert [(f["tabla"], f["registro_id"]) for f in filas] == [("planes", plan_id)]


async def test_borrar_el_gimnasio_completo_no_falla_por_los_disparadores(fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio(con_superadmin=False)
    await fabrica.crear_staff(gym)
    await _sql(
        gym.id,
        "INSERT INTO platform.planes (gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:g, 'Plan', 1000, 1, 'individual')",
        {"g": gym.id},
    )
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(text("DELETE FROM platform.tenant WHERE id = :id"), {"id": gym.id})
        restos = await conn.execute(text("SELECT count(*) FROM platform.sync_eliminados WHERE gimnasio_id = :id"), {"id": gym.id})
        assert restos.scalar() == 0
    fabrica.gimnasios.remove(gym)


async def test_solo_cambiar_la_contrasena_mueve_password_cambiada_en(fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    staff = await fabrica.crear_staff(gym)
    consulta = "SELECT password_cambiada_en FROM platform.staff WHERE id = :id"

    await _sql(gym.id, "UPDATE platform.staff SET nombre = 'Otro Nombre' WHERE id = :id", {"id": staff["id"]})
    assert (await _sql(gym.id, consulta, {"id": staff["id"]}))[0]["password_cambiada_en"] is None

    await _sql(gym.id, "UPDATE platform.staff SET hash_password = 'otro-hash' WHERE id = :id", {"id": staff["id"]})
    assert (await _sql(gym.id, consulta, {"id": staff["id"]}))[0]["password_cambiada_en"] is not None


async def test_insertar_con_los_disparadores_apagados_igual_deja_marca(fabrica: Fabrica):
    """Una restauración de respaldo o un proceso de mantenimiento apagan los disparadores."""
    gym = await fabrica.crear_gimnasio()
    plan_id = uuid4()
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(text("SET LOCAL session_replication_role = replica"))
        await conn.execute(
            text("INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:id, :g, 'Sin disparador', 1000, 1, 'individual')"),
            {"id": plan_id, "g": gym.id},
        )
    fila = (await _sql(gym.id, "SELECT sync_xid FROM platform.planes WHERE id = :id", {"id": plan_id}))[0]
    assert fila["sync_xid"] is not None and fila["sync_xid"] > 0


# --- Migración 071 ---
async def test_congelamientos_y_ventas_llevan_marca_y_avisan_su_borrado(fabrica: Fabrica):
    from tests import sync_util as u

    gym = await fabrica.crear_gimnasio()
    staff = await fabrica.crear_staff(gym)
    dep = await u.deportista(gym.id)
    mem = await u.membresia(gym.id, dep, await u.plan(gym.id), vence_en_dias=10)
    cong = await u.congelamiento(gym.id, mem)
    venta = await u.venta(gym.id, staff["id"], dep)

    antes = (await _sql(gym.id, "SELECT sync_xid FROM platform.ventas WHERE id = :id", {"id": venta}))[0]["sync_xid"]
    await _sql(gym.id, "UPDATE platform.ventas SET anulada = true, motivo_anulacion = 'Error', anulada_en = now() WHERE id = :id", {"id": venta})
    despues = (await _sql(gym.id, "SELECT sync_xid FROM platform.ventas WHERE id = :id", {"id": venta}))[0]["sync_xid"]
    assert despues > antes

    await _sql(gym.id, "DELETE FROM platform.congelamientos WHERE id = :id", {"id": cong})
    filas = await _sql(gym.id, "SELECT tabla, registro_id::text AS id FROM platform.sync_eliminados")
    assert [(f["tabla"], f["id"]) for f in filas] == [("congelamientos", cong)]


async def test_un_ingreso_de_estacion_no_entra_dos_veces_y_el_de_la_web_sigue_igual(fabrica: Fabrica):
    from tests import sync_util as u

    gym = await fabrica.crear_gimnasio()
    dep = await u.deportista(gym.id)
    operacion = uuid4()
    insertar = """INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, operacion_id)
                  VALUES (:g, :d, 'ingreso', 'manual', 'abrio', :op)"""
    await _sql(gym.id, insertar, {"g": gym.id, "d": dep, "op": operacion})
    with pytest.raises(DBAPIError):
        await _sql(gym.id, insertar, {"g": gym.id, "d": dep, "op": operacion})
    # Desde la web no hay operación: se pueden registrar varios.
    await _sql(gym.id, insertar, {"g": gym.id, "d": dep, "op": None})
    await _sql(gym.id, insertar, {"g": gym.id, "d": dep, "op": None})
    assert len(await _sql(gym.id, "SELECT 1 FROM platform.checkins")) == 3
