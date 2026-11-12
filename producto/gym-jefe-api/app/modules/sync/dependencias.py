"""Autenticación de una estación de GymDesk Escritorio por su device_token."""
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contexto_gimnasio import fijar_gimnasio
from app.core.database import get_db_session
from app.core.dependencies import gimnasio_suspendido_exception, verificar_suscripcion_operativa
from app.core.security import hash_token

_bearer = HTTPBearer(auto_error=False)


@dataclass
class EstacionAutenticada:
    id: UUID
    gimnasio_id: UUID
    nombre: str
    subdominio: str
    gimnasio_nombre: str
    gimnasio_activo: bool


def _no_autorizada(codigo: str, mensaje: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"codigo": codigo, "mensaje": mensaje},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_estacion(
    credenciales: Annotated[HTTPAuthorizationCredentials | None, Security(_bearer)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EstacionAutenticada:
    """
    Valida el device_token y fija el gimnasio para toda la transacción (RLS).
    No mira la suscripción: lo ya cobrado sin red se recibe aunque el gimnasio esté bloqueado.
    """
    if credenciales is None or not credenciales.credentials:
        raise _no_autorizada("ESTACION_NO_AUTORIZADA", "Esta estación no está activada.")

    token_hash = hash_token(credenciales.credentials.strip())
    res = await session.execute(text("SELECT platform.gimnasio_id_por_device_token(:h)"), {"h": token_hash})
    gym_id = res.scalar()
    if gym_id is None:
        raise _no_autorizada("ESTACION_NO_AUTORIZADA", "Esta estación no está activada.")
    await fijar_gimnasio(session, gym_id)

    res = await session.execute(
        text("""
            SELECT e.id, e.nombre, e.revocada_en, t.subdominio, t.nombre AS gimnasio_nombre, t.activo
            FROM platform.estaciones e
            JOIN platform.tenant t ON t.id = e.gimnasio_id
            WHERE e.device_token_hash = :h AND e.gimnasio_id = :gym
        """),
        {"h": token_hash, "gym": gym_id},
    )
    fila = res.mappings().first()
    if not fila:
        raise _no_autorizada("ESTACION_NO_AUTORIZADA", "Esta estación no está activada.")
    if fila["revocada_en"] is not None:
        raise _no_autorizada(
            "ESTACION_REVOCADA",
            "El Jefe del gimnasio revocó esta estación. Pídele un código nuevo para volver a activarla.",
        )
    return EstacionAutenticada(
        id=fila["id"], gimnasio_id=gym_id, nombre=fila["nombre"], subdominio=fila["subdominio"],
        gimnasio_nombre=fila["gimnasio_nombre"], gimnasio_activo=fila["activo"],
    )


async def get_estacion_operativa(
    estacion: Annotated[EstacionAutenticada, Depends(get_estacion)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EstacionAutenticada:
    """Además exige que el gimnasio pueda operar (GW-RF-51 CA3): si está bloqueado, 403."""
    if not estacion.gimnasio_activo:
        raise gimnasio_suspendido_exception("suspendido")
    await verificar_suscripcion_operativa(session, estacion.gimnasio_id)
    return estacion


Estacion = Annotated[EstacionAutenticada, Depends(get_estacion)]
EstacionOperativa = Annotated[EstacionAutenticada, Depends(get_estacion_operativa)]
