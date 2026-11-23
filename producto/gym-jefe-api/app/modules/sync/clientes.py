"""
Registrar un cliente desde la estación (decisión E-41 del 22-nov-2026). Exige conexión.

- Mismas reglas que la web: se reutiliza `DeportistasService.crear_deportista` (consentimiento Ley 1581,
  menor de edad con acudiente, documento único por gimnasio, auditoría).
- Quien registra es una persona del gimnasio con sesión en la estación: debe seguir activa y tener permiso de
  crear deportistas (el Jefe siempre). Sin fila de permiso, no lo tiene.
- La foto es opcional. Se valida por sus primeros bytes (JPG, PNG o WEBP) y hasta 3 MB, y se guarda en
  `platform.deportista_fotos`, que no es pública.
"""
import base64
import binascii
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.modules.deportistas.schemas import CrearDeportistaRequest
from app.modules.deportistas.service import DeportistasService
from app.modules.my_gym.service import MAX_BYTES_IMAGEN, MyGymService
from app.modules.sync.dependencias import EstacionAutenticada

# El texto en base64 ocupa 4/3 del binario.
MAX_FOTO_BASE64 = (MAX_BYTES_IMAGEN * 4) // 3 + 8


class RegistrarClienteRequest(BaseModel):
    staff_id: UUID
    cliente: CrearDeportistaRequest
    foto_base64: Optional[str] = Field(None, max_length=MAX_FOTO_BASE64)


class ClienteRegistradoDto(BaseModel):
    id: UUID
    tipo_documento: Optional[str]
    documento: str
    nombre: str
    activo: bool
    con_foto: bool


def _error(codigo: str, mensaje: str, http: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=http, detail={"codigo": codigo, "mensaje": mensaje})


def decodificar_foto(texto: str) -> tuple[bytes, str]:
    # Acepta también el prefijo de un data URL ("data:image/jpeg;base64,...").
    if texto.startswith("data:"):
        texto = texto.split(",", 1)[-1]
    try:
        contenido = base64.b64decode(texto, validate=True)
    except (binascii.Error, ValueError):
        raise _error("FOTO_NO_VALIDA", "La foto no llegó bien. Tómala de nuevo.")
    if len(contenido) > MAX_BYTES_IMAGEN:
        raise _error("FOTO_MUY_GRANDE", "La foto no puede pesar más de 3 MB.", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    media_type = MyGymService._tipo_de_imagen(contenido)
    if not media_type:
        raise _error("FOTO_NO_VALIDA", "La foto debe ser JPG, PNG o WEBP.")
    return contenido, media_type


async def guardar_foto(session: AsyncSession, gym_id: UUID, deportista_id: UUID, contenido: bytes, media_type: str,
                       staff_id: UUID, staff_nombre: str, origen: str) -> None:
    await session.execute(
        text("""
            INSERT INTO platform.deportista_fotos (deportista_id, gimnasio_id, contenido, media_type, subida_por)
            VALUES (:d, :g, :c, :m, :s)
            ON CONFLICT (deportista_id) DO UPDATE
              SET contenido = EXCLUDED.contenido, media_type = EXCLUDED.media_type, subida_por = EXCLUDED.subida_por, updated_at = now()
        """),
        {"d": deportista_id, "g": gym_id, "c": contenido, "m": media_type, "s": staff_id},
    )
    await AuditService.registrar(
        session=session, gimnasio_id=gym_id, actor_id=staff_id, actor_nombre=staff_nombre,
        accion="SUBIR_FOTO_DEPORTISTA", entidad="deportistas", entidad_id=str(deportista_id),
        detalle={"media_type": media_type, "bytes": len(contenido), "origen": origen},
    )


async def _staff_con_permiso(session: AsyncSession, estacion: EstacionAutenticada, staff_id: UUID) -> dict:
    res = await session.execute(
        text("SELECT id, nombre, rol, activo, deleted_at FROM platform.staff WHERE id = :s AND gimnasio_id = :g"),
        {"s": staff_id, "g": estacion.gimnasio_id},
    )
    staff = res.mappings().first()
    if not staff or not staff["activo"] or staff["deleted_at"] is not None:
        raise _error("STAFF_NO_AUTORIZADO", "Tu usuario no está activo en este gimnasio. Pídele ayuda al Jefe.", status.HTTP_403_FORBIDDEN)
    if staff["rol"] != "jefe":
        res = await session.execute(
            text("SELECT puede_crear FROM platform.permisos_rol WHERE gimnasio_id = :g AND rol = :r AND submodulo = 'deportistas'"),
            {"g": estacion.gimnasio_id, "r": staff["rol"]},
        )
        if not res.scalar_one_or_none():
            raise _error("PERMISO_DENEGADO", "No tienes permiso para registrar clientes. Pídeselo al Jefe.", status.HTTP_403_FORBIDDEN)
    return dict(staff)


async def registrar(session: AsyncSession, estacion: EstacionAutenticada, data: RegistrarClienteRequest) -> ClienteRegistradoDto:
    staff = await _staff_con_permiso(session, estacion, data.staff_id)
    # La foto se valida antes de crear nada: si viene mal, no queda un cliente a medias.
    foto = decodificar_foto(data.foto_base64) if data.foto_base64 else None
    dep = await DeportistasService.crear_deportista(
        session=session, gym_id=estacion.gimnasio_id, staff_id=staff["id"], staff_nombre=staff["nombre"], req=data.cliente,
    )
    if foto:
        await guardar_foto(session, estacion.gimnasio_id, dep.id, foto[0], foto[1], staff["id"], staff["nombre"],
                           f"estacion:{estacion.nombre}")
    return ClienteRegistradoDto(
        id=dep.id, tipo_documento=dep.tipo_documento, documento=dep.documento, nombre=dep.nombre, activo=dep.activo,
        con_foto=foto is not None,
    )
