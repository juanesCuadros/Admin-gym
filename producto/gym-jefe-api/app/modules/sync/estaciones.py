"""Estaciones de GymDesk Escritorio: las crea y revoca el Jefe; se activan con un código de un solo uso."""
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.security import hash_token
from app.modules.sync.schemas import EstacionConCodigoDto, EstacionDto

# El código de activación vence a las 24 h y sirve una sola vez.
HORAS_CODIGO = 24
# Sin 0/O ni 1/I/L: se dicta por teléfono y se escribe a mano.
_ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_LARGO_CODIGO = 8

_SELECT = """
    SELECT e.id, e.nombre, e.codigo_hash, e.codigo_expira_en, e.activada_en, e.nombre_equipo, e.version_app,
           e.ultima_sync_en, e.revocada_en, e.motivo_revocacion, e.created_at, s.nombre AS creada_por_nombre
    FROM platform.estaciones e
    LEFT JOIN platform.staff s ON s.id = e.creada_por
"""


def generar_codigo() -> str:
    return "".join(secrets.choice(_ALFABETO) for _ in range(_LARGO_CODIGO))


def normalizar_codigo(codigo: str) -> str:
    """Acepta el código con guion, espacios o minúsculas, como lo escriba la persona."""
    return "".join(c for c in codigo.upper() if c.isalnum())


def presentar_codigo(codigo: str) -> str:
    return f"{codigo[:4]}-{codigo[4:]}"


def _estado(fila: dict, ahora: datetime) -> str:
    if fila["revocada_en"] is not None:
        return "revocada"
    if fila["activada_en"] is not None:
        return "activa"
    if fila["codigo_expira_en"] is None or fila["codigo_expira_en"] <= ahora:
        return "codigo_vencido"
    return "por_activar"


def _a_dto(fila: dict, ahora: datetime) -> EstacionDto:
    datos = {k: v for k, v in dict(fila).items() if k != "codigo_hash"}
    datos["estado"] = _estado(fila, ahora)
    if datos["estado"] != "por_activar":
        datos["codigo_expira_en"] = None
    return EstacionDto(**datos)


def _no_encontrada() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"codigo": "ESTACION_NO_ENCONTRADA", "mensaje": "No encontramos esa estación."},
    )


class EstacionesService:
    @staticmethod
    async def _obtener(session: AsyncSession, gym_id: UUID, estacion_id: UUID, bloquear: bool = False) -> dict:
        res = await session.execute(
            text(_SELECT + " WHERE e.id = :id AND e.gimnasio_id = :gym" + (" FOR UPDATE OF e" if bloquear else "")),
            {"id": estacion_id, "gym": gym_id},
        )
        fila = res.mappings().first()
        if not fila:
            raise _no_encontrada()
        return dict(fila)

    @classmethod
    async def listar(cls, session: AsyncSession, gym_id: UUID) -> List[EstacionDto]:
        res = await session.execute(
            text(_SELECT + " WHERE e.gimnasio_id = :gym ORDER BY (e.revocada_en IS NOT NULL), e.created_at DESC"),
            {"gym": gym_id},
        )
        ahora = datetime.now(timezone.utc)
        return [_a_dto(f, ahora) for f in res.mappings().all()]

    @classmethod
    async def crear(
        cls, session: AsyncSession, gym_id: UUID, staff_id: UUID, staff_nombre: str, nombre: str
    ) -> EstacionConCodigoDto:
        nombre = " ".join(nombre.split())
        codigo = generar_codigo()
        expira = datetime.now(timezone.utc) + timedelta(hours=HORAS_CODIGO)
        try:
            async with session.begin_nested():
                res = await session.execute(
                    text("""
                        INSERT INTO platform.estaciones (gimnasio_id, nombre, codigo_hash, codigo_expira_en, creada_por)
                        VALUES (:gym, :nombre, :hash, :expira, :staff) RETURNING id
                    """),
                    {"gym": gym_id, "nombre": nombre, "hash": hash_token(codigo), "expira": expira, "staff": staff_id},
                )
                estacion_id = res.scalar_one()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "ESTACION_NOMBRE_DUPLICADO", "mensaje": "Ya hay una estación con ese nombre. Usa otro para distinguirlas."},
            )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=staff_id, actor_nombre=staff_nombre,
            accion="CREAR_ESTACION", entidad="estaciones", entidad_id=estacion_id, detalle={"nombre": nombre},
        )
        fila = await cls._obtener(session, gym_id, estacion_id)
        return EstacionConCodigoDto(**_a_dto(fila, datetime.now(timezone.utc)).model_dump(), codigo=presentar_codigo(codigo))

    @classmethod
    async def regenerar_codigo(
        cls, session: AsyncSession, gym_id: UUID, estacion_id: UUID, staff_id: UUID, staff_nombre: str
    ) -> EstacionConCodigoDto:
        fila = await cls._obtener(session, gym_id, estacion_id, bloquear=True)
        if fila["revocada_en"] is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "ESTACION_YA_REVOCADA", "mensaje": "Esta estación fue revocada. Crea una nueva."},
            )
        if fila["activada_en"] is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "ESTACION_YA_ACTIVADA", "mensaje": "Esta estación ya está activada. Para volver a instalarla, revócala y crea una nueva."},
            )
        codigo = generar_codigo()
        expira = datetime.now(timezone.utc) + timedelta(hours=HORAS_CODIGO)
        await session.execute(
            text("UPDATE platform.estaciones SET codigo_hash = :hash, codigo_expira_en = :expira WHERE id = :id AND gimnasio_id = :gym"),
            {"hash": hash_token(codigo), "expira": expira, "id": estacion_id, "gym": gym_id},
        )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=staff_id, actor_nombre=staff_nombre,
            accion="REGENERAR_CODIGO_ESTACION", entidad="estaciones", entidad_id=estacion_id, detalle={"nombre": fila["nombre"]},
        )
        fila = await cls._obtener(session, gym_id, estacion_id)
        return EstacionConCodigoDto(**_a_dto(fila, datetime.now(timezone.utc)).model_dump(), codigo=presentar_codigo(codigo))

    @classmethod
    async def revocar(
        cls, session: AsyncSession, gym_id: UUID, estacion_id: UUID, staff_id: UUID, staff_nombre: str, motivo: str
    ) -> EstacionDto:
        fila = await cls._obtener(session, gym_id, estacion_id, bloquear=True)
        if fila["revocada_en"] is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "ESTACION_YA_REVOCADA", "mensaje": "Esta estación ya estaba revocada."},
            )
        motivo = motivo.strip()
        # Se borran el código y el token: la estación deja de poder sincronizar de inmediato.
        await session.execute(
            text("""
                UPDATE platform.estaciones
                SET revocada_en = now(), revocada_por = :staff, motivo_revocacion = :motivo,
                    codigo_hash = NULL, codigo_expira_en = NULL
                WHERE id = :id AND gimnasio_id = :gym
            """),
            {"staff": staff_id, "motivo": motivo, "id": estacion_id, "gym": gym_id},
        )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=staff_id, actor_nombre=staff_nombre,
            accion="REVOCAR_ESTACION", entidad="estaciones", entidad_id=estacion_id,
            detalle={"nombre": fila["nombre"], "motivo": motivo, "estaba_activada": fila["activada_en"] is not None},
        )
        return _a_dto(await cls._obtener(session, gym_id, estacion_id), datetime.now(timezone.utc))
