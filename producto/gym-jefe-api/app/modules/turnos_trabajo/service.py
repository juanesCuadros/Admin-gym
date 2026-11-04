"""
Turno de trabajo (decisión de Juan del 4-nov-2026): cada persona registra su entrada y su salida,
varias pueden estar en turno a la vez y el sistema calcula las horas. No toca dinero ni la caja.
"""
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.timezone import get_local_day_range_utc, today_local
from app.modules.turnos_trabajo.schemas import (
    CerrarTurnoAjenoRequest,
    ListadoTurnosTrabajoResponse,
    MiTurnoResponse,
    ResumenPersona,
    TurnoTrabajoItem,
)

SELECT_TURNO = """
    SELECT t.id, t.staff_id, s.nombre AS staff_nombre, s.rol AS staff_rol, t.entrada_en, t.salida_en,
           c.nombre AS cerrado_por_nombre, t.motivo_cierre,
           CASE WHEN t.salida_en IS NULL THEN NULL
                ELSE floor(extract(epoch FROM t.salida_en - t.entrada_en) / 60)::int END AS minutos
    FROM platform.turnos_trabajo t
    JOIN platform.staff s ON s.id = t.staff_id
    LEFT JOIN platform.staff c ON c.id = t.cerrado_por
"""


class TurnosTrabajoService:
    @staticmethod
    async def _por_id(session: AsyncSession, gym_id: UUID, turno_id: UUID) -> Optional[TurnoTrabajoItem]:
        fila = (
            await session.execute(
                text(SELECT_TURNO + " WHERE t.id = :id AND t.gimnasio_id = :gym_id"), {"id": turno_id, "gym_id": gym_id}
            )
        ).mappings().first()
        return TurnoTrabajoItem(**dict(fila)) if fila else None

    @classmethod
    async def mi_turno(cls, session: AsyncSession, gym_id: UUID, staff_id: UUID) -> MiTurnoResponse:
        fila = (
            await session.execute(
                text(SELECT_TURNO + " WHERE t.gimnasio_id = :gym_id AND t.staff_id = :staff AND t.salida_en IS NULL"),
                {"gym_id": gym_id, "staff": staff_id},
            )
        ).mappings().first()
        inicio, fin = get_local_day_range_utc(today_local())
        minutos = (
            await session.execute(
                text("""
                    SELECT COALESCE(SUM(floor(extract(epoch FROM salida_en - entrada_en) / 60)), 0)::int
                    FROM platform.turnos_trabajo
                    WHERE gimnasio_id = :gym_id AND staff_id = :staff AND salida_en IS NOT NULL
                      AND entrada_en BETWEEN :inicio AND :fin
                """),
                {"gym_id": gym_id, "staff": staff_id, "inicio": inicio, "fin": fin},
            )
        ).scalar_one()
        return MiTurnoResponse(abierto=TurnoTrabajoItem(**dict(fila)) if fila else None, minutos_hoy=minutos)

    @classmethod
    async def registrar_entrada(cls, session: AsyncSession, gym_id: UUID, staff_id: UUID, staff_nombre: str) -> TurnoTrabajoItem:
        conflicto = HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"codigo": "TURNO_TRABAJO_YA_ABIERTO", "mensaje": "Ya tienes un turno de trabajo abierto."},
        )
        try:
            async with session.begin_nested():
                turno_id = (
                    await session.execute(
                        text("INSERT INTO platform.turnos_trabajo (gimnasio_id, staff_id) VALUES (:gym_id, :staff) RETURNING id"),
                        {"gym_id": gym_id, "staff": staff_id},
                    )
                ).scalar_one()
        except IntegrityError:
            raise conflicto
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=staff_id, actor_nombre=staff_nombre,
            accion="ENTRADA_TURNO_TRABAJO", entidad="turnos_trabajo", entidad_id=str(turno_id), detalle={},
        )
        return await cls._por_id(session, gym_id, turno_id)

    @classmethod
    async def registrar_salida(cls, session: AsyncSession, gym_id: UUID, staff_id: UUID, staff_nombre: str) -> TurnoTrabajoItem:
        turno_id = (
            await session.execute(
                text("""
                    UPDATE platform.turnos_trabajo SET salida_en = now()
                    WHERE gimnasio_id = :gym_id AND staff_id = :staff AND salida_en IS NULL
                    RETURNING id
                """),
                {"gym_id": gym_id, "staff": staff_id},
            )
        ).scalar()
        if not turno_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "SIN_TURNO_TRABAJO_ABIERTO", "mensaje": "No tienes un turno de trabajo abierto."},
            )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=staff_id, actor_nombre=staff_nombre,
            accion="SALIDA_TURNO_TRABAJO", entidad="turnos_trabajo", entidad_id=str(turno_id), detalle={},
        )
        return await cls._por_id(session, gym_id, turno_id)

    @classmethod
    async def cerrar_ajeno(
        cls, session: AsyncSession, gym_id: UUID, actor_id: UUID, actor_nombre: str, turno_id: UUID, req: CerrarTurnoAjenoRequest
    ) -> TurnoTrabajoItem:
        """Si alguien olvidó marcar la salida, el Jefe pone la hora real; si no, las horas saldrían infladas."""
        turno = await cls._por_id(session, gym_id, turno_id)
        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "TURNO_TRABAJO_NO_ENCONTRADO", "mensaje": "Ese turno no existe en este gimnasio."},
            )
        if turno.salida_en is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "TURNO_TRABAJO_YA_CERRADO", "mensaje": "Ese turno ya está cerrado."},
            )
        salida = req.salida_en
        if salida.tzinfo is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "HORA_SALIDA_INVALIDA", "mensaje": "La hora de salida debe indicar su zona horaria."},
            )
        if salida < turno.entrada_en or salida > datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "HORA_SALIDA_INVALIDA", "mensaje": "La salida debe estar entre la entrada y la hora actual."},
            )
        await session.execute(
            text("""
                UPDATE platform.turnos_trabajo SET salida_en = :salida, cerrado_por = :actor, motivo_cierre = :motivo
                WHERE id = :id AND gimnasio_id = :gym_id
            """),
            {"salida": salida, "actor": actor_id, "motivo": req.motivo.strip(), "id": turno_id, "gym_id": gym_id},
        )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=actor_id, actor_nombre=actor_nombre,
            accion="CERRAR_TURNO_TRABAJO_AJENO", entidad="turnos_trabajo", entidad_id=str(turno_id),
            detalle={"persona": turno.staff_nombre, "salida": salida.isoformat(), "motivo": req.motivo.strip()},
        )
        return await cls._por_id(session, gym_id, turno_id)

    @staticmethod
    async def listar(
        session: AsyncSession, gym_id: UUID, desde: date, hasta: date, staff_id: Optional[UUID], limit: int, offset: int
    ) -> ListadoTurnosTrabajoResponse:
        """Cada turno cuenta en el día de Bogotá en que empezó. Los abiertos no suman horas todavía."""
        if hasta < desde:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "RANGO_FECHAS_INVALIDO", "mensaje": "La fecha inicial no puede ser posterior a la final."},
            )
        inicio, _ = get_local_day_range_utc(desde)
        _, fin = get_local_day_range_utc(hasta)
        condicion = "t.gimnasio_id = :gym_id AND t.entrada_en BETWEEN :inicio AND :fin"
        params = {"gym_id": gym_id, "inicio": inicio, "fin": fin, "limit": limit, "offset": offset}
        if staff_id:
            condicion += " AND t.staff_id = :staff"
            params["staff"] = staff_id
        total = (
            await session.execute(text(f"SELECT COUNT(*) FROM platform.turnos_trabajo t WHERE {condicion}"), params)
        ).scalar_one()
        filas = await session.execute(
            text(SELECT_TURNO + f" WHERE {condicion} ORDER BY t.entrada_en DESC LIMIT :limit OFFSET :offset"), params
        )
        resumen = await session.execute(
            text(f"""
                SELECT t.staff_id, s.nombre AS staff_nombre,
                       COALESCE(SUM(floor(extract(epoch FROM t.salida_en - t.entrada_en) / 60)), 0)::int AS minutos,
                       COUNT(*)::int AS turnos,
                       COUNT(*) FILTER (WHERE t.salida_en IS NULL)::int AS abiertos
                FROM platform.turnos_trabajo t
                JOIN platform.staff s ON s.id = t.staff_id
                WHERE {condicion}
                GROUP BY t.staff_id, s.nombre
                ORDER BY s.nombre
            """),
            params,
        )
        return ListadoTurnosTrabajoResponse(
            desde=desde,
            hasta=hasta,
            items=[TurnoTrabajoItem(**dict(f)) for f in filas.mappings().all()],
            total=total,
            resumen=[ResumenPersona(**dict(f)) for f in resumen.mappings().all()],
        )
