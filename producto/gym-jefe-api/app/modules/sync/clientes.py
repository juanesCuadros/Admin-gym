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
from app.modules.deportistas.schemas import CrearDeportistaRequest, MedicionCorporalResponse, RegistrarMedicionRequest
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


from app.core.imagenes import optimizar_foto_deportista


def decodificar_foto(texto: str) -> tuple[bytes, str]:
    """Valida, recorta 1:1 y comprime a WebP liviano (~15 KB) para no inflar PostgreSQL."""
    return optimizar_foto_deportista(texto)


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


# ---------------------------------------------------------------------------
# Mediciones desde la estación (registrar y consultar). Exigen conexión; mismas reglas de la web.
# ---------------------------------------------------------------------------
class RegistrarMedicionEstacionRequest(BaseModel):
    staff_id: UUID
    medicion: RegistrarMedicionRequest


async def _staff_que_lee(session: AsyncSession, estacion: EstacionAutenticada, staff_id: UUID) -> dict:
    res = await session.execute(
        text("SELECT id, nombre, rol, activo, deleted_at FROM platform.staff WHERE id = :s AND gimnasio_id = :g"),
        {"s": staff_id, "g": estacion.gimnasio_id},
    )
    staff = res.mappings().first()
    if not staff or not staff["activo"] or staff["deleted_at"] is not None:
        raise _error("STAFF_NO_AUTORIZADO", "Tu usuario no está activo en este gimnasio. Pídele ayuda al Jefe.", status.HTTP_403_FORBIDDEN)
    if staff["rol"] != "jefe":
        res = await session.execute(
            text("SELECT puede_leer FROM platform.permisos_rol WHERE gimnasio_id = :g AND rol = :r AND submodulo = 'deportistas'"),
            {"g": estacion.gimnasio_id, "r": staff["rol"]},
        )
        if not res.scalar_one_or_none():
            raise _error("PERMISO_DENEGADO", "No tienes permiso para ver clientes. Pídeselo al Jefe.", status.HTTP_403_FORBIDDEN)
    return dict(staff)


class PerfilMedidas(BaseModel):
    """Lo que ya se sabe del cliente para precargar la toma y calcular grasa y músculo igual que el servidor."""
    sexo: Optional[str] = None
    altura_cm: Optional[float] = None
    edad: Optional[int] = None


class MedicionesEstacionResponse(BaseModel):
    perfil: PerfilMedidas
    mediciones: list[MedicionCorporalResponse]


async def mediciones(session: AsyncSession, estacion: EstacionAutenticada, deportista_id: UUID, staff_id: UUID) -> MedicionesEstacionResponse:
    await _staff_que_lee(session, estacion, staff_id)
    fila = (await session.execute(
        text("""SELECT sexo, altura_cm, fecha_nacimiento FROM platform.deportistas
                WHERE id = :d AND gimnasio_id = :g AND deleted_at IS NULL"""),
        {"d": deportista_id, "g": estacion.gimnasio_id},
    )).mappings().first()
    if not fila:
        raise _error("DEPORTISTA_NO_ENCONTRADO", "Deportista no encontrado.", status.HTTP_404_NOT_FOUND)
    edad = None
    if fila["fecha_nacimiento"]:
        hoy = DeportistasService._obtener_fecha_hoy_bogota()
        n = fila["fecha_nacimiento"]
        # Mismo rango que usa el servidor al calcular (10 a 95 años).
        edad = max(10, min(95, hoy.year - n.year - ((hoy.month, hoy.day) < (n.month, n.day))))
    lista = await DeportistasService.listar_mediciones(session=session, gym_id=estacion.gimnasio_id, deportista_id=deportista_id)
    return MedicionesEstacionResponse(
        perfil=PerfilMedidas(sexo=fila["sexo"], altura_cm=float(fila["altura_cm"]) if fila["altura_cm"] else None, edad=edad),
        mediciones=lista,
    )


async def registrar_medicion(session: AsyncSession, estacion: EstacionAutenticada, deportista_id: UUID, data: RegistrarMedicionEstacionRequest):
    staff = await _staff_con_permiso(session, estacion, data.staff_id)
    return await DeportistasService.registrar_medicion(
        session=session, gym_id=estacion.gimnasio_id, staff_id=staff["id"], staff_nombre=staff["nombre"],
        deportista_id=deportista_id, req=data.medicion,
    )
