"""Ayudas compartidas por las pruebas de GymDesk Escritorio (tests/test_e*.py)."""
from typing import Optional
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from tests.conftest import Fabrica, Gimnasio, login

API = "/api/v1"


async def sql(gym_id: Optional[UUID], consulta: str, params: Optional[dict] = None) -> list:
    """Ejecuta como la aplicación (rol gymos_platform), con o sin gimnasio fijado."""
    async with async_session_maker() as s:
        if gym_id is not None:
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym_id)})
        res = await s.execute(text(consulta), params or {})
        filas = [dict(f) for f in res.mappings().all()] if res.returns_rows else []
        await s.commit()
        return filas


async def cabeceras(cliente: AsyncClient, gym: Gimnasio, staff: dict) -> dict:
    r = await login(cliente, gym, staff)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def gimnasio_con_jefe(cliente: AsyncClient, fabrica: Fabrica, **kwargs):
    gym = await fabrica.crear_gimnasio(**kwargs)
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    return gym, jefe, await cabeceras(cliente, gym, jefe)


async def crear_estacion(cliente: AsyncClient, headers: dict, nombre: Optional[str] = None) -> dict:
    r = await cliente.post(f"{API}/estaciones", json={"nombre": nombre or f"Recepción {uuid4().hex[:5]}"}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def acciones_auditoria(gym_id: UUID) -> list:
    filas = await sql(gym_id, "SELECT accion, detalle, actor_nombre FROM platform.auditoria_gym ORDER BY id")
    return filas


def cod(r) -> str:
    """Código de error de una respuesta de la API."""
    return r.json()["error"]["codigo"]


async def activar(cliente: AsyncClient, gym: Gimnasio, estacion: dict) -> dict:
    """Activa la estación recién creada y devuelve las cabeceras con su device_token."""
    r = await cliente.post(
        f"{API}/sync/activar",
        json={"subdominio": gym.subdominio, "codigo": estacion["codigo"], "nombre_equipo": "PC-PRUEBAS", "version_app": "0.1.0"},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


async def estacion_activa(cliente: AsyncClient, fabrica: Fabrica, **kwargs):
    """Gimnasio con Jefe y una estación ya activada."""
    gym, jefe, headers_jefe = await gimnasio_con_jefe(cliente, fabrica, **kwargs)
    estacion = await crear_estacion(cliente, headers_jefe)
    return gym, jefe, headers_jefe, estacion, await activar(cliente, gym, estacion)


async def bloquear_gimnasio(fabrica: Fabrica, gym: Gimnasio) -> None:
    """Deja al gimnasio bloqueado por falta de pago (corte hace 10 días)."""
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(
            text("UPDATE superadmin.gimnasios SET fecha_corte = current_date - 10 WHERE gimnasio_id = :g"), {"g": gym.id}
        )


# --- Datos de negocio para las pruebas de ingreso (fase 2) ---
async def deportista(gym_id, nombre: str = "Ana Ruiz", documento: Optional[str] = None, activo: bool = True) -> str:
    dep_id = uuid4()
    await sql(
        gym_id,
        """INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, activo)
           VALUES (:id, :g, 'CC', :doc, :nombre, :activo)""",
        {"id": dep_id, "g": gym_id, "doc": documento or uuid4().hex[:10], "nombre": nombre, "activo": activo},
    )
    return str(dep_id)


async def plan(gym_id, nombre: Optional[str] = None) -> str:
    plan_id = uuid4()
    await sql(
        gym_id,
        "INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:id, :g, :n, 80000, 30, 'individual')",
        {"id": plan_id, "g": gym_id, "n": nombre or f"Plan {uuid4().hex[:5]}"},
    )
    return str(plan_id)


async def membresia(gym_id, deportista_id: str, plan_id: str, vence_en_dias: int, cancelada: bool = False, dias_de_creada: int = 0) -> str:
    """Membresía que vence `vence_en_dias` días después de hoy en Bogotá (negativo: ya venció)."""
    mem_id = uuid4()
    await sql(
        gym_id,
        """INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at)
           VALUES (:id, :g, :d, :p,
                   (now() AT TIME ZONE 'America/Bogota')::date + CAST(:v AS int) - 60,
                   (now() AT TIME ZONE 'America/Bogota')::date + CAST(:v AS int), :c,
                   now() - make_interval(days => CAST(:dc AS int)))""",
        {"id": mem_id, "g": gym_id, "d": deportista_id, "p": plan_id, "v": vence_en_dias, "c": cancelada, "dc": dias_de_creada},
    )
    return str(mem_id)


async def congelamiento(gym_id, membresia_id: str, desde_dias: int = -1, hasta_dias: Optional[int] = None) -> str:
    """Congelamiento relativo a hoy en Bogotá. Sin `hasta_dias` queda vigente."""
    cong_id = uuid4()
    await sql(
        gym_id,
        """INSERT INTO platform.congelamientos (id, gimnasio_id, membresia_id, fecha_inicio, fecha_fin)
           VALUES (:id, :g, :m,
                   (now() AT TIME ZONE 'America/Bogota')::date + CAST(:d AS int),
                   CASE WHEN CAST(:h AS int) IS NULL THEN NULL
                        ELSE (now() AT TIME ZONE 'America/Bogota')::date + CAST(:h AS int) END)""",
        {"id": cong_id, "g": gym_id, "m": membresia_id, "d": desde_dias, "h": hasta_dias},
    )
    return str(cong_id)


async def venta(gym_id, staff_id, deportista_id: Optional[str], tipo_item: str = "pase_dia", hace_dias: int = 0, anulada: bool = False) -> str:
    """Venta con un solo ítem, en un turno ya cerrado, hecha `hace_dias` días atrás."""
    turno_id, venta_id = uuid4(), uuid4()
    await sql(
        gym_id,
        """INSERT INTO platform.turnos_caja (id, gimnasio_id, staff_id, estado, cerrado_en, efectivo_contado, diferencia)
           VALUES (:id, :g, :s, 'cerrado', now(), 0, 0)""",
        {"id": turno_id, "g": gym_id, "s": staff_id},
    )
    await sql(
        gym_id,
        """INSERT INTO platform.ventas (id, gimnasio_id, turno_id, deportista_id, total, metodo, tipo_medio, idempotency_key,
                                        registrada_por, created_at, anulada, motivo_anulacion, anulada_en)
           VALUES (:id, :g, :t, :d, 10000, 'efectivo', 'efectivo', :k, :s, now() - make_interval(days => CAST(:h AS int)),
                   :a, CASE WHEN :a THEN 'Prueba' END, CASE WHEN :a THEN now() END)""",
        {"id": venta_id, "g": gym_id, "t": turno_id, "d": deportista_id, "k": uuid4().hex, "s": staff_id, "h": hace_dias, "a": anulada},
    )
    await sql(
        gym_id,
        """INSERT INTO platform.venta_items (gimnasio_id, venta_id, tipo, descripcion, cantidad, precio_unitario, subtotal)
           VALUES (:g, :v, :tipo, 'Ítem de prueba', 1, 10000, 10000)""",
        {"g": gym_id, "v": venta_id, "tipo": tipo_item},
    )
    return str(venta_id)


async def descargar_todo(cliente: AsyncClient, headers: dict, cursor: Optional[str] = None) -> tuple[dict, list, str]:
    """Sigue la paginación de /sync/pull hasta terminar la ronda: (cambios por tabla, eliminados, cursor final)."""
    cambios: dict = {}
    eliminados: list = []
    for _ in range(200):
        r = await cliente.get(f"{API}/sync/pull", params={"cursor": cursor} if cursor else {}, headers=headers)
        assert r.status_code == 200, r.text
        cuerpo = r.json()
        for tabla, filas in cuerpo["cambios"].items():
            cambios.setdefault(tabla, []).extend(filas)
        eliminados.extend(cuerpo["eliminados"])
        cursor = cuerpo["cursor"]
        if not cuerpo["hay_mas"]:
            return cambios, eliminados, cursor
    raise AssertionError("la paginación no terminó")
