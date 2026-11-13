"""
Ingresos y cortesías que la estación registró (tipos `ingreso` y `cortesia` de `/sync/push`).

El servidor guarda lo que pasó; no lo vuelve a decidir: la puerta ya se abrió o ya se negó. Si con sus
propios datos habría negado un ingreso que la estación permitió, lo registra igual y lo deja por
revisar con el motivo. Un ingreso que llega tarde no dispara el "Bienvenido" de la Pantalla TV.
"""
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.timezone import LOCAL_TZ, get_local_day_range_utc
from app.modules.membresias.domain import EstadoMembresiaCalculado, MembresiaDomainService
from app.modules.sync.push import Contexto, Efecto, OperacionInvalida, Revision

# Hasta aquí se le cree al reloj del equipo. Con más desfase, la hora se corrige y queda por revisar.
TOLERANCIA_RELOJ = timedelta(minutes=5)


class _PayloadIngreso(BaseModel):
    deportista_id: UUID
    metodo: Literal["manual", "huella"]
    resultado: Literal["abrio", "alerta_mora", "negado"]
    # Lo que la estación calculó, para poder explicarle al Jefe una diferencia.
    estado: str = Field(..., min_length=1, max_length=20)
    con_pase_dia: bool = False


class _PayloadCortesia(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255)


def hora_del_ingreso(ctx: Contexto) -> tuple[datetime, Optional[Revision]]:
    """
    Hora que se guarda para algo que ocurrió en la estación.
    - Reloj del equipo a 5 minutos o menos del servidor: se acepta su hora.
    - Más desfase: se corrige con ese desfase y queda por revisar.
    - Una hora en el futuro (equipo adelantado y sin dato para corregir): se usa la de llegada.
    """
    ahora = datetime.now(timezone.utc)
    ocurrida = ctx.op.ocurrida_en.astimezone(timezone.utc)
    desfase = ctx.desfase
    if desfase is not None and abs(desfase) > TOLERANCIA_RELOJ:
        corregida = min(ocurrida + desfase, ahora)
    elif ocurrida > ahora + TOLERANCIA_RELOJ:
        corregida, desfase = ahora, ahora - ocurrida
    else:
        return ocurrida, None
    minutos = int(abs(desfase).total_seconds() // 60)
    sentido = "atrasado" if desfase > timedelta(0) else "adelantado"
    return corregida, Revision(
        entidad="checkins", entidad_id=None, motivo_codigo="RELOJ_DESFASADO",
        motivo=f"El reloj de la estación {ctx.estacion.nombre} estaba {sentido} {minutos} minutos. La hora se corrigió.",
        detalle={"hora_estacion": ocurrida.isoformat(), "hora_corregida": corregida.isoformat(), "minutos": minutos, "sentido": sentido},
    )


async def _revision_de_staff(ctx: Contexto) -> Optional[Revision]:
    """Quien registró debe seguir activo y con permiso de control de ingreso. Si no, queda por revisar."""
    staff = ctx.staff
    if not staff["activo"] or staff["deleted_at"] is not None:
        return Revision(
            entidad="staff", entidad_id=str(staff["id"]), motivo_codigo="STAFF_DESACTIVADO",
            motivo=f"{staff['nombre']} registró un ingreso en la estación {ctx.estacion.nombre} y en el sistema figura desactivado.",
        )
    if staff["rol"] == "jefe":
        return None
    res = await ctx.session.execute(
        text("SELECT puede_crear FROM platform.permisos_rol WHERE gimnasio_id = :g AND rol = :rol AND submodulo = 'control_ingreso'"),
        {"g": ctx.estacion.gimnasio_id, "rol": staff["rol"]},
    )
    if not res.scalar_one_or_none():  # sin fila de permiso, no lo tiene (fail-closed)
        return Revision(
            entidad="staff", entidad_id=str(staff["id"]), motivo_codigo="STAFF_SIN_PERMISO",
            motivo=f"{staff['nombre']} registró un ingreso en la estación {ctx.estacion.nombre} sin tener permiso de control de ingreso.",
        )
    return None


def _unir(revisiones: List[Optional[Revision]], entidad_id: str) -> Optional[Revision]:
    """Una operación deja una sola revisión: la más importante manda y las demás van en su detalle."""
    reales = [r for r in revisiones if r is not None]
    if not reales:
        return None
    principal = reales[0]
    if principal.entidad == "checkins":
        principal.entidad_id = entidad_id
    else:
        principal.detalle = {**principal.detalle, "checkin_id": entidad_id}
    if len(reales) > 1:
        principal.detalle = {
            **principal.detalle,
            "otros_motivos": [{"motivo_codigo": r.motivo_codigo, "motivo": r.motivo, **r.detalle} for r in reales[1:]],
        }
    return principal


async def estado_en_fecha(
    session: AsyncSession, gym_id: UUID, deportista_id: UUID, activo: bool, dia: date, dias_gracia: int, dias_umbral: int
) -> EstadoMembresiaCalculado:
    """
    Regla de acceso evaluada para un día dado. Mismas consultas que
    `MembresiaDomainService.calcular_estado_para_deportista`, que solo sabe evaluar "hoy".
    """
    res = await session.execute(
        text("""
            SELECT m.id, m.fecha_vencimiento, p.nombre AS plan_nombre
            FROM platform.membresias m JOIN platform.planes p ON p.id = m.plan_id
            WHERE m.gimnasio_id = :g AND m.deportista_id = :d AND m.cancelada = false
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC LIMIT 1
        """),
        {"g": gym_id, "d": deportista_id},
    )
    memb = res.mappings().first()
    if not memb:
        res = await session.execute(
            text("""
                SELECT cancelada FROM platform.membresias WHERE gimnasio_id = :g AND deportista_id = :d
                ORDER BY fecha_vencimiento DESC, created_at DESC LIMIT 1
            """),
            {"g": gym_id, "d": deportista_id},
        )
        ultima = res.mappings().first()
        return MembresiaDomainService.evaluar_estado_puro(
            hoy=dia, activo_deportista=activo, tiene_membresia=False, ultima_cancelada=bool(ultima and ultima["cancelada"]),
            dias_gracia_mora=dias_gracia, dias_umbral_por_vencer=dias_umbral,
        )
    res = await session.execute(
        text("""
            SELECT id FROM platform.congelamientos
            WHERE gimnasio_id = :g AND membresia_id = :m AND fecha_inicio <= :dia AND (fecha_fin IS NULL OR fecha_fin > :dia)
            LIMIT 1
        """),
        {"g": gym_id, "m": memb["id"], "dia": dia},
    )
    return MembresiaDomainService.evaluar_estado_puro(
        hoy=dia, activo_deportista=activo, tiene_membresia=True, fecha_vencimiento=memb["fecha_vencimiento"],
        congelamiento_activo=res.first() is not None, dias_gracia_mora=dias_gracia, dias_umbral_por_vencer=dias_umbral,
        membresia_id=memb["id"], plan_nombre=memb["plan_nombre"],
    )


async def _tiene_pase_dia(session: AsyncSession, gym_id: UUID, deportista_id: UUID, dia: date) -> bool:
    inicio, fin = get_local_day_range_utc(dia)
    res = await session.execute(
        text("""
            SELECT EXISTS (
              SELECT 1 FROM platform.ventas v JOIN platform.venta_items i ON i.venta_id = v.id
              WHERE v.gimnasio_id = :g AND v.deportista_id = :d AND v.anulada = false
                AND i.tipo = 'pase_dia' AND v.created_at BETWEEN :inicio AND :fin
            )
        """),
        {"g": gym_id, "d": deportista_id, "inicio": inicio, "fin": fin},
    )
    return bool(res.scalar_one())


async def _revision_de_acceso(ctx: Contexto, datos: _PayloadIngreso, dep: dict, momento: datetime) -> Optional[Revision]:
    """La estación dejó entrar y el servidor, con sus datos de ese día, habría negado."""
    if datos.resultado == "negado":
        return None
    gym_id = ctx.estacion.gimnasio_id
    dia = momento.astimezone(LOCAL_TZ).date()
    if dep["deleted_at"] is not None:
        estado, mensaje = "eliminado", "El cliente fue eliminado del sistema"
    else:
        calc = await estado_en_fecha(
            ctx.session, gym_id, dep["id"], dep["activo"], dia, dep["dias_gracia_mora"], dep["dias_umbral_por_vencer"]
        )
        if calc.permite_ingreso:
            return None
        if dep["activo"] and await _tiene_pase_dia(ctx.session, gym_id, dep["id"], dia):
            return None
        estado, mensaje = calc.estado, calc.mensaje
    return Revision(
        entidad="checkins", entidad_id=None, motivo_codigo="ACCESO_NO_COINCIDE",
        motivo=f"La estación {ctx.estacion.nombre} dejó entrar a {dep['nombre']} y el sistema lo habría negado: {mensaje}.",
        detalle={
            "deportista_id": str(dep["id"]), "deportista": dep["nombre"], "dia": dia.isoformat(),
            "estado_en_la_estacion": datos.estado, "con_pase_dia_en_la_estacion": datos.con_pase_dia,
            "estado_en_el_servidor": estado,
        },
    )


def _exigir_staff(ctx: Contexto) -> None:
    if ctx.staff is None:
        raise OperacionInvalida("STAFF_REQUERIDO", "El ingreso no dice quién lo registró.")


async def ingreso(ctx: Contexto) -> Efecto:
    try:
        datos = _PayloadIngreso(**ctx.op.payload)
    except ValidationError:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "El ingreso no trae los datos esperados.")
    _exigir_staff(ctx)
    gym_id = ctx.estacion.gimnasio_id

    res = await ctx.session.execute(
        text("""
            SELECT d.id, d.nombre, d.activo, d.deleted_at, t.dias_gracia_mora, t.dias_umbral_por_vencer
            FROM platform.deportistas d JOIN platform.tenant t ON t.id = d.gimnasio_id
            WHERE d.id = :d AND d.gimnasio_id = :g
        """),
        {"d": datos.deportista_id, "g": gym_id},
    )
    dep = res.mappings().first()
    if not dep:
        raise OperacionInvalida("DEPORTISTA_DESCONOCIDO", "El cliente del ingreso no pertenece a este gimnasio.")

    momento, revision_reloj = hora_del_ingreso(ctx)
    res = await ctx.session.execute(
        text("""
            INSERT INTO platform.checkins
              (gimnasio_id, deportista_id, tipo, metodo, resultado, registrado_por, ts_utc, estacion_id, operacion_id, recibido_en)
            VALUES (:g, :d, 'ingreso', :metodo, :resultado, :staff, :ts, :e, :op, now())
            RETURNING id
        """),
        {
            "g": gym_id, "d": dep["id"], "metodo": datos.metodo, "resultado": datos.resultado, "staff": ctx.staff["id"],
            "ts": momento, "e": ctx.estacion.id, "op": ctx.op.id,
        },
    )
    checkin_id = res.scalar_one()

    revision = _unir(
        [await _revision_de_staff(ctx), await _revision_de_acceso(ctx, datos, dict(dep), momento), revision_reloj],
        str(checkin_id),
    )
    return Efecto(respuesta={"checkin_id": checkin_id, "ts_utc": momento.isoformat()}, revision=revision)


async def cortesia(ctx: Contexto) -> Efecto:
    try:
        datos = _PayloadCortesia(**ctx.op.payload)
    except ValidationError:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "La cortesía no trae un motivo válido (mínimo 4 letras).")
    _exigir_staff(ctx)
    gym_id = ctx.estacion.gimnasio_id
    motivo = datos.motivo.strip()
    if len(motivo) < 4:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "La cortesía no trae un motivo válido (mínimo 4 letras).")

    momento, revision_reloj = hora_del_ingreso(ctx)
    res = await ctx.session.execute(
        text("""
            INSERT INTO platform.checkins
              (gimnasio_id, deportista_id, tipo, metodo, resultado, motivo_cortesia, registrado_por, ts_utc,
               estacion_id, operacion_id, recibido_en)
            VALUES (:g, NULL, 'cortesia', 'manual', 'abrio', :motivo, :staff, :ts, :e, :op, now())
            RETURNING id
        """),
        {"g": gym_id, "motivo": motivo, "staff": ctx.staff["id"], "ts": momento, "e": ctx.estacion.id, "op": ctx.op.id},
    )
    checkin_id = res.scalar_one()
    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=ctx.staff["id"], actor_nombre=ctx.staff["nombre"],
        accion="INGRESO_CORTESIA", entidad="checkins", entidad_id=str(checkin_id),
        detalle={"motivo": motivo, "estacion": ctx.estacion.nombre, "ocurrida_en": momento.isoformat(), "operacion_id": str(ctx.op.id)},
    )
    revision = _unir([await _revision_de_staff(ctx), revision_reloj], str(checkin_id))
    return Efecto(respuesta={"checkin_id": checkin_id, "ts_utc": momento.isoformat()}, revision=revision)
