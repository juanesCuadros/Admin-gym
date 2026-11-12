"""
Recepción de lo que la estación hizo sin red (`POST /sync/push`).

Sin colas ni procesos en segundo plano: cada operación se valida, se persiste y se audita dentro de
la misma petición, en su propio punto de guardado. Reglas (ALCANCE_APP_ESCRITORIO.md §5.1):

- aplicada            se hizo.
- duplicada           ya se había recibido: se devuelve el resultado original. No es un error.
- pendiente_revision  conflicto de negocio: se registra igual y queda marcada con su motivo.
- invalida            contenido mal formado (un error de programación): no se guarda nada.
- retenida            depende de una operación inválida, retenida o que aún no ha llegado: no se
                      procesa suelta. La estación la vuelve a enviar cuando su dependencia se resuelva.
"""
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.modules.sync.dependencias import EstacionAutenticada
from app.modules.sync.schemas import PushResponse, ResultadoOperacionDto

MAX_OPERACIONES = 50


class Operacion(BaseModel):
    id: UUID
    tipo: str = Field(..., min_length=2, max_length=60)
    idempotency_key: str = Field(..., min_length=8, max_length=128)
    ocurrida_en: datetime
    staff_id: Optional[UUID] = None
    depende_de: List[UUID] = Field(default_factory=list, max_length=20)
    payload: Dict[str, Any] = Field(default_factory=dict)


class OperacionInvalida(Exception):
    def __init__(self, codigo: str, mensaje: str):
        self.codigo, self.mensaje = codigo, mensaje


@dataclass
class Revision:
    entidad: str
    entidad_id: Optional[str]
    motivo_codigo: str
    motivo: str
    detalle: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Efecto:
    """Lo que dejó una operación aceptada."""
    respuesta: Dict[str, Any] = field(default_factory=dict)
    revision: Optional[Revision] = None


@dataclass
class Contexto:
    session: AsyncSession
    estacion: EstacionAutenticada
    op: Operacion
    staff: Optional[dict]  # fila de platform.staff de quien hizo la operación, si la envió


Manejador = Callable[[Contexto], Awaitable[Efecto]]


# ---------------------------------------------------------------------------
# Tipo `auditoria_estacion`: eventos de sesión de la estación (ingresos, bloqueos, cambios de PIN)
# ---------------------------------------------------------------------------
_ACCIONES_ESTACION = {
    "CREAR_BASE_LOCAL", "ACTIVAR_ESTACION", "INICIAR_SESION", "INGRESO_FALLIDO", "BLOQUEAR_SESION",
    "DESBLOQUEAR_SESION", "CERRAR_SESION", "CREAR_PIN", "CAMBIAR_PIN", "INVALIDAR_CREDENCIAL",
}
# Si quien las hizo ya no está activo en el servidor, el evento se registra y queda por revisar.
_ACCIONES_QUE_EXIGEN_STAFF_ACTIVO = {"INICIAR_SESION", "DESBLOQUEAR_SESION", "CREAR_PIN", "CAMBIAR_PIN"}
_CLAVES_PROHIBIDAS = ("password", "contrasena", "contraseña", "pin", "token", "hash", "clave", "secreto")


class _PayloadAuditoria(BaseModel):
    accion: str
    entidad: str = Field(..., min_length=1, max_length=40)
    entidad_id: Optional[str] = Field(None, max_length=64)
    detalle: Dict[str, Any] = Field(default_factory=dict)


def _sin_secretos(valor: Any) -> Any:
    if isinstance(valor, dict):
        return {k: _sin_secretos(v) for k, v in valor.items() if not any(p in k.lower() for p in _CLAVES_PROHIBIDAS)}
    if isinstance(valor, list):
        return [_sin_secretos(v) for v in valor]
    return valor


async def _auditoria_estacion(ctx: Contexto) -> Efecto:
    try:
        datos = _PayloadAuditoria(**ctx.op.payload)
    except ValidationError:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "El evento de la estación no trae los datos esperados.")
    if datos.accion not in _ACCIONES_ESTACION:
        raise OperacionInvalida("ACCION_DESCONOCIDA", f"La acción '{datos.accion}' no es un evento de estación conocido.")
    detalle = _sin_secretos(datos.detalle)
    if len(json.dumps(detalle)) > 2000:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "El detalle del evento es demasiado grande.")

    staff = ctx.staff
    await AuditService.registrar(
        session=ctx.session,
        gimnasio_id=ctx.estacion.gimnasio_id,
        actor_id=staff["id"] if staff else None,
        actor_nombre=staff["nombre"] if staff else f"Estación {ctx.estacion.nombre}",
        accion=f"ESTACION_{datos.accion}",
        entidad="estaciones",
        entidad_id=ctx.estacion.id,
        detalle={
            **detalle,
            "estacion": ctx.estacion.nombre,
            "ocurrida_en": ctx.op.ocurrida_en.astimezone(timezone.utc).isoformat(),
            "operacion_id": str(ctx.op.id),
            "entidad_local": datos.entidad,
            "entidad_id_local": datos.entidad_id,
        },
    )

    revision = None
    if staff and datos.accion in _ACCIONES_QUE_EXIGEN_STAFF_ACTIVO and (not staff["activo"] or staff["deleted_at"] is not None):
        revision = Revision(
            entidad="staff",
            entidad_id=str(staff["id"]),
            motivo_codigo="STAFF_DESACTIVADO",
            motivo=f"{staff['nombre']} usó la estación {ctx.estacion.nombre} y en el sistema figura desactivado.",
            detalle={"accion": datos.accion, "ocurrida_en": ctx.op.ocurrida_en.astimezone(timezone.utc).isoformat()},
        )
    return Efecto(respuesta={"accion": datos.accion}, revision=revision)


# Cada fase agrega aquí sus tipos (ingresos en la fase 2, caja en la 3).
MANEJADORES: Dict[str, Manejador] = {
    "auditoria_estacion": _auditoria_estacion,
}


# ---------------------------------------------------------------------------
# Motor
# ---------------------------------------------------------------------------
def _huella(op: Operacion) -> str:
    """Huella del contenido: detecta un mismo id reutilizado con otros datos."""
    contenido = json.dumps(
        {
            "tipo": op.tipo,
            "clave": op.idempotency_key,
            "ocurrida_en": op.ocurrida_en.astimezone(timezone.utc).isoformat(),
            "staff_id": str(op.staff_id) if op.staff_id else None,
            "payload": op.payload,
        },
        sort_keys=True, separators=(",", ":"), default=str,
    )
    return hashlib.sha256(contenido.encode()).hexdigest()


class PushService:
    @staticmethod
    async def _buscar_previa(session: AsyncSession, gym_id: UUID, op: Operacion) -> Optional[dict]:
        res = await session.execute(
            text("""
                SELECT operacion_id, idempotency_key, contenido_hash, resultado, respuesta
                FROM platform.sync_operaciones
                WHERE gimnasio_id = :g AND (operacion_id = :id OR idempotency_key = :clave)
                ORDER BY (operacion_id = :id) DESC
                LIMIT 1
            """),
            {"g": gym_id, "id": op.id, "clave": op.idempotency_key},
        )
        fila = res.mappings().first()
        return dict(fila) if fila else None

    @staticmethod
    def _desde_previa(indice: int, op: Operacion, previa: dict) -> ResultadoOperacionDto:
        if previa["operacion_id"] != op.id:
            return ResultadoOperacionDto(
                indice=indice, id=op.id, resultado="invalida", codigo="CLAVE_IDEMPOTENCIA_EN_USO",
                mensaje="La clave de idempotencia ya se usó en otra operación.",
            )
        if previa["contenido_hash"] != _huella(op):
            return ResultadoOperacionDto(
                indice=indice, id=op.id, resultado="invalida", codigo="OPERACION_ID_REUTILIZADO",
                mensaje="Ya se recibió una operación con este identificador y otro contenido.",
            )
        return ResultadoOperacionDto(
            indice=indice, id=op.id, resultado="duplicada", resultado_original=previa["resultado"], datos=previa["respuesta"],
        )

    @classmethod
    async def _aplicar(cls, session: AsyncSession, estacion: EstacionAutenticada, indice: int, op: Operacion) -> ResultadoOperacionDto:
        gym_id = estacion.gimnasio_id
        manejador = MANEJADORES.get(op.tipo)
        if manejador is None:
            raise OperacionInvalida("TIPO_DESCONOCIDO", f"El servidor no conoce el tipo de operación '{op.tipo}'.")

        staff = None
        if op.staff_id is not None:
            res = await session.execute(
                text("SELECT id, nombre, rol, activo, deleted_at FROM platform.staff WHERE id = :id AND gimnasio_id = :g"),
                {"id": op.staff_id, "g": gym_id},
            )
            fila = res.mappings().first()
            if not fila:
                raise OperacionInvalida("STAFF_DESCONOCIDO", "La persona que hizo la operación no pertenece a este gimnasio.")
            staff = dict(fila)

        efecto = await manejador(Contexto(session=session, estacion=estacion, op=op, staff=staff))
        resultado = "pendiente_revision" if efecto.revision else "aplicada"
        res = await session.execute(
            text("""
                INSERT INTO platform.sync_operaciones
                  (gimnasio_id, estacion_id, operacion_id, tipo, idempotency_key, contenido_hash, staff_id,
                   ocurrida_en, resultado, respuesta)
                VALUES (:g, :e, :id, :tipo, :clave, :hash, :staff, :ocurrida, :resultado, CAST(:respuesta AS jsonb))
                RETURNING id
            """),
            {
                "g": gym_id, "e": estacion.id, "id": op.id, "tipo": op.tipo, "clave": op.idempotency_key,
                "hash": _huella(op), "staff": op.staff_id, "ocurrida": op.ocurrida_en, "resultado": resultado,
                "respuesta": json.dumps(efecto.respuesta, default=str),
            },
        )
        fila_id = res.scalar_one()

        revision_dto = None
        if efecto.revision:
            r = efecto.revision
            await session.execute(
                text("""
                    INSERT INTO platform.sync_revisiones
                      (gimnasio_id, operacion_id, estacion_id, entidad, entidad_id, motivo_codigo, motivo, detalle)
                    VALUES (:g, :op, :e, :entidad, :entidad_id, :codigo, :motivo, CAST(:detalle AS jsonb))
                """),
                {
                    "g": gym_id, "op": fila_id, "e": estacion.id, "entidad": r.entidad, "entidad_id": r.entidad_id,
                    "codigo": r.motivo_codigo, "motivo": r.motivo, "detalle": json.dumps(r.detalle, default=str),
                },
            )
            await AuditService.registrar(
                session=session, gimnasio_id=gym_id, actor_id=None, actor_nombre=f"Estación {estacion.nombre}",
                accion="SYNC_PENDIENTE_REVISION", entidad=r.entidad, entidad_id=r.entidad_id,
                detalle={"motivo_codigo": r.motivo_codigo, "motivo": r.motivo, "operacion_id": str(op.id), "tipo": op.tipo},
            )
            revision_dto = {"motivo_codigo": r.motivo_codigo, "motivo": r.motivo}

        return ResultadoOperacionDto(indice=indice, id=op.id, resultado=resultado, datos=efecto.respuesta, revision=revision_dto)

    @classmethod
    async def push(cls, session: AsyncSession, estacion: EstacionAutenticada, crudas: List[Dict[str, Any]]) -> PushResponse:
        gym_id = estacion.gimnasio_id
        resultados: List[ResultadoOperacionDto] = []
        # Operaciones de este lote que no quedaron hechas: lo que dependa de ellas se retiene.
        sin_resolver: set[UUID] = set()

        for indice, cruda in enumerate(crudas):
            try:
                op = Operacion(**cruda)
            except (ValidationError, TypeError):
                id_crudo = None
                try:
                    id_crudo = UUID(str(cruda.get("id"))) if isinstance(cruda, dict) else None
                except ValueError:
                    pass
                if id_crudo:
                    sin_resolver.add(id_crudo)
                resultados.append(ResultadoOperacionDto(
                    indice=indice, id=id_crudo, resultado="invalida", codigo="OPERACION_MAL_FORMADA",
                    mensaje="La operación no trae los campos obligatorios o vienen con un formato inválido.",
                ))
                continue

            previa = await cls._buscar_previa(session, gym_id, op)
            if previa:
                resultado = cls._desde_previa(indice, op, previa)
                if resultado.resultado == "invalida":
                    sin_resolver.add(op.id)
                resultados.append(resultado)
                continue

            # Dependencias: tienen que estar hechas, en este lote o en uno anterior.
            pendientes = [d for d in op.depende_de if d in sin_resolver]
            if not pendientes and op.depende_de:
                hechas_en_lote = {r.id for r in resultados if r.resultado in ("aplicada", "duplicada", "pendiente_revision")}
                por_buscar = [d for d in op.depende_de if d not in hechas_en_lote]
                if por_buscar:
                    res = await session.execute(
                        text("SELECT operacion_id FROM platform.sync_operaciones WHERE gimnasio_id = :g AND operacion_id = ANY(:ids)"),
                        {"g": gym_id, "ids": por_buscar},
                    )
                    recibidas = {f[0] for f in res.fetchall()}
                    pendientes = [d for d in por_buscar if d not in recibidas]
            if pendientes:
                sin_resolver.add(op.id)
                resultados.append(ResultadoOperacionDto(
                    indice=indice, id=op.id, resultado="retenida", codigo="DEPENDENCIA_PENDIENTE",
                    mensaje="Esta operación depende de otra que aún no se pudo registrar. Se procesará cuando esa se resuelva.",
                    datos={"depende_de": [str(d) for d in pendientes]},
                ))
                continue

            try:
                async with session.begin_nested():
                    resultados.append(await cls._aplicar(session, estacion, indice, op))
            except OperacionInvalida as e:
                sin_resolver.add(op.id)
                resultados.append(ResultadoOperacionDto(indice=indice, id=op.id, resultado="invalida", codigo=e.codigo, mensaje=e.mensaje))
            except IntegrityError:
                # Otra petición registró la misma operación al tiempo: se responde con lo que quedó.
                previa = await cls._buscar_previa(session, gym_id, op)
                if not previa:
                    raise
                resultados.append(cls._desde_previa(indice, op, previa))

        await session.execute(
            text("UPDATE platform.estaciones SET ultima_sync_en = now() WHERE id = :id AND gimnasio_id = :g"),
            {"id": estacion.id, "g": gym_id},
        )
        return PushResponse(resultados=resultados, servidor_ahora=datetime.now(timezone.utc))
