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
