"""
Bandeja "Por revisar": lo que una estación registró y el servidor marcó para que el Jefe lo mire.

Mismo vocabulario que la revisión de turnos (061): `pendiente_revision` → `revisado`, una sola vez,
con nota. Lo que no mueve dinero (ingresos, sesiones) solo se da por visto. Aplicar, ajustar o
anular son para dinero y llegan con la caja sin red.
"""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService

# Entidades sin dinero: su única resolución es "visto".
_SIN_DINERO = {"checkins", "staff", "estaciones"}


class RevisionDto(BaseModel):
    id: UUID
    entidad: str
    entidad_id: Optional[str] = None
    tipo_operacion: str
    motivo_codigo: str
    motivo: str
    detalle: Dict[str, Any]
    estacion_nombre: str
    registrado_por_nombre: Optional[str] = None
    ocurrida_en: datetime
    recibida_en: datetime
    estado_revision: Literal["pendiente_revision", "revisado"]
    # Qué puede hacer el Jefe con esta revisión mientras está pendiente.
    resoluciones_posibles: List[str]
    resolucion: Optional[str] = None
    revisado_por_nombre: Optional[str] = None
    revisado_en: Optional[datetime] = None
    nota_revision: Optional[str] = None


class ListadoRevisionesResponse(BaseModel):
    total: int
    pendientes: int
    items: List[RevisionDto]


class RevisarRequest(BaseModel):
    resolucion: Literal["visto"] = Field(..., description="Por ahora solo 'visto' (movimientos sin dinero)")
    nota: str = Field(..., min_length=4, max_length=500, description="Nota obligatoria de quien revisa")


_SELECT = """
    SELECT r.id, r.entidad, r.entidad_id, o.tipo AS tipo_operacion, r.motivo_codigo, r.motivo, r.detalle,
           e.nombre AS estacion_nombre, s.nombre AS registrado_por_nombre, o.ocurrida_en, o.recibida_en,
           r.estado_revision, r.resolucion, j.nombre AS revisado_por_nombre, r.revisado_en, r.nota_revision
    FROM platform.sync_revisiones r
    JOIN platform.sync_operaciones o ON o.id = r.operacion_id
    JOIN platform.estaciones e ON e.id = r.estacion_id
    LEFT JOIN platform.staff s ON s.id = o.staff_id
    LEFT JOIN platform.staff j ON j.id = r.revisado_por
"""


def _a_dto(fila: dict) -> RevisionDto:
    pendiente = fila["estado_revision"] == "pendiente_revision"
    posibles = ["visto"] if pendiente and fila["entidad"] in _SIN_DINERO else []
    return RevisionDto(**fila, resoluciones_posibles=posibles)


class RevisionesService:
    @staticmethod
    async def listar(session: AsyncSession, gym_id: UUID, estado: str, limit: int, offset: int) -> ListadoRevisionesResponse:
        filtro = "" if estado == "todas" else "AND r.estado_revision = :estado"
        params = {"g": gym_id, "estado": estado, "limit": limit, "offset": offset}
        res = await session.execute(
            text("""
                SELECT count(*) FILTER (WHERE :estado = 'todas' OR r.estado_revision = :estado) AS total,
                       count(*) FILTER (WHERE r.estado_revision = 'pendiente_revision') AS pendientes
                FROM platform.sync_revisiones r WHERE r.gimnasio_id = :g
            """),
            {"g": gym_id, "estado": estado},
        )
        conteo = res.mappings().one()
        res = await session.execute(
            text(f"{_SELECT} WHERE r.gimnasio_id = :g {filtro} ORDER BY r.created_at DESC, r.id LIMIT :limit OFFSET :offset"),
            params,
        )
        return ListadoRevisionesResponse(
            total=conteo["total"], pendientes=conteo["pendientes"], items=[_a_dto(dict(f)) for f in res.mappings().all()]
        )

    @staticmethod
    async def revisar(
        session: AsyncSession, gym_id: UUID, revision_id: UUID, jefe_id: UUID, jefe_nombre: str, data: RevisarRequest
    ) -> RevisionDto:
        res = await session.execute(
            text("SELECT id, entidad, entidad_id, motivo_codigo, estado_revision FROM platform.sync_revisiones WHERE id = :id AND gimnasio_id = :g FOR UPDATE"),
            {"id": revision_id, "g": gym_id},
        )
        actual = res.mappings().first()
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "REVISION_NO_ENCONTRADA", "mensaje": "No existe esa revisión en este gimnasio."},
            )
        if actual["estado_revision"] != "pendiente_revision":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "REVISION_YA_REVISADA", "mensaje": "Esta revisión ya fue cerrada. Solo se revisa una vez."},
            )
        if actual["entidad"] not in _SIN_DINERO:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "RESOLUCION_NO_DISPONIBLE",
                    "mensaje": "Este movimiento tiene dinero y no se puede cerrar solo con 'visto'.",
                },
            )
        nota = data.nota.strip()
        if len(nota) < 4:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "NOTA_REQUERIDA", "mensaje": "Escribe una nota de al menos 4 letras."},
            )
        await session.execute(
            text("""
                UPDATE platform.sync_revisiones
                SET estado_revision = 'revisado', resolucion = :res, revisado_por = :jefe, revisado_en = now(), nota_revision = :nota
                WHERE id = :id AND gimnasio_id = :g
            """),
            {"res": data.resolucion, "jefe": jefe_id, "nota": nota, "id": revision_id, "g": gym_id},
        )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=jefe_id, actor_nombre=jefe_nombre,
            accion="REVISAR_SYNC", entidad=actual["entidad"], entidad_id=actual["entidad_id"],
            detalle={"revision_id": str(revision_id), "motivo_codigo": actual["motivo_codigo"], "resolucion": data.resolucion, "nota": nota},
        )
        res = await session.execute(text(f"{_SELECT} WHERE r.id = :id AND r.gimnasio_id = :g"), {"id": revision_id, "g": gym_id})
        return _a_dto(dict(res.mappings().one()))
