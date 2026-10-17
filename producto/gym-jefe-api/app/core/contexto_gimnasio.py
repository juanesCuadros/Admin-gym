"""
Contexto de gimnasio (RLS) para las rutas que no tienen sesión de staff.

Sin `app.gimnasio_id` fijado, las políticas de platform no dejan ver ni escribir nada (migración 040).
Las rutas públicas (login, refresh, recuperación de contraseña, branding, Pantalla TV) solo conocen un
dato que trae el usuario: el subdominio o un token. Estas funciones lo resuelven a un gimnasio con una
función SECURITY DEFINER acotada (devuelve solo el id) y fijan el contexto para el resto de la
transacción. Si no hay gimnasio, no fijan nada: las consultas siguientes no encuentran filas y la ruta
responde su "no encontrado" de siempre.
"""
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def fijar_gimnasio(session: AsyncSession, gym_id: UUID) -> None:
    """SET LOCAL app.gimnasio_id para la transacción en curso."""
    await session.execute(
        text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
        {"gym_id": str(gym_id)},
    )


async def _resolver_y_fijar(session: AsyncSession, funcion: str, valor: str) -> Optional[UUID]:
    res = await session.execute(text(f"SELECT platform.{funcion}(:valor)"), {"valor": valor})
    gym_id = res.scalar()
    if gym_id is not None:
        await fijar_gimnasio(session, gym_id)
    return gym_id


async def fijar_gimnasio_por_subdominio(session: AsyncSession, subdominio: str) -> Optional[UUID]:
    return await _resolver_y_fijar(session, "gimnasio_id_por_subdominio", subdominio.lower().strip())


async def fijar_gimnasio_por_refresh(session: AsyncSession, refresh_hash: str) -> Optional[UUID]:
    return await _resolver_y_fijar(session, "gimnasio_id_por_refresh", refresh_hash)


async def fijar_gimnasio_por_token_recuperacion(session: AsyncSession, token_hash: str) -> Optional[UUID]:
    return await _resolver_y_fijar(session, "gimnasio_id_por_token_recuperacion", token_hash)
