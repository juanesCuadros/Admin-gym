"""
Membresías de la estación (fase 3B, parte 1): tipos `membresia_renovar` y `membresia_vender` de `/sync/push`.

Reglas (ALCANCE_APP_ESCRITORIO.md E-36 y §5.1, decisiones del 22-nov-2026):
- Sin red se renueva una membresía existente o se vende una nueva a un cliente ya registrado. Paquetes,
  cambio de plan y congelar quedan para la web.
- El dinero cobrado sin red nunca se pierde: un conflicto de negocio no rechaza la operación, se registra
  y queda por revisar con su motivo. Solo lo que no se puede guardar (la membresía o el cliente ya no
  existen) es inválido, y la estación lo deja visible en su cola sin descartarlo.
- La fecha la recalcula el servidor con la regla C2 y el día en que ocurrió el cobro (regla de reloj de
  E-28). Si no coincide con la de la estación, manda la del servidor y queda por revisar.
- Precio: se respeta el que cobró la estación y se marca si difiere del actual. Descuento fuera de la regla
  vigente: se registra y se marca.
- Ids de punta a punta (E-38): el pago usa el id de su operación y la membresía vendida, el id que le dio
  la estación.
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.audit import AuditService
from app.core.timezone import LOCAL_TZ
from app.modules.caja.reglas import calcular_vencimiento_renovacion_c2
from app.modules.caja.service import CajaService
from app.modules.sync.caja import (
    MAX_MONTO,
    _exigir_staff,
    _hora,
    _leer,
    _Medio,
    _pct,
    _permiso_caja,
    _regla_descuento_actual,
    _revision_turno_cerrado,
    _turno_de_la_estacion,
    _unir,
)
from app.modules.sync.push import Contexto, Efecto, OperacionInvalida, Revision

MAX_DIAS = 3650


class _PayloadCobro(BaseModel):
    turno_id: UUID
    membresia_id: UUID
    deportista_id: UUID
    dias: int = Field(..., ge=1, le=MAX_DIAS)
    precio_lista: int = Field(..., ge=1, le=MAX_MONTO)
    precio_cobrado: int = Field(..., ge=1, le=MAX_MONTO)
    motivo_descuento: Optional[str] = Field(None, max_length=255)
    tipo_medio: Literal["efectivo", "otro", "mixto"]
    metodo: str = Field(..., min_length=2, max_length=50)
    pagos: List[_Medio] = Field(default_factory=list, max_length=5)
    valor_recibido: Optional[int] = Field(None, ge=0, le=MAX_MONTO)


class _PayloadRenovar(_PayloadCobro):
    fecha_vencimiento_anterior: date
    fecha_vencimiento_nueva: date


class _PayloadVender(_PayloadCobro):
    plan_id: UUID
    fecha_inicio: date
    fecha_vencimiento: date


def _validar_cobro(datos: _PayloadCobro) -> None:
    """Lo que la estación nunca debería mandar: es un error de programación, no un conflicto."""
    if datos.precio_cobrado < datos.precio_lista and not (datos.motivo_descuento or "").strip():
        raise OperacionInvalida("MOTIVO_DESCUENTO_REQUERIDO", "El descuento del cobro no trae motivo.")
    if datos.tipo_medio == "mixto":
        if len(datos.pagos) < 2 or sum(m.monto for m in datos.pagos) != datos.precio_cobrado:
            raise OperacionInvalida("MEDIOS_NO_SUMAN_TOTAL", "Los medios del pago mixto no suman lo cobrado.")
    elif datos.pagos:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "Solo un pago mixto trae el reparto por medios.")
    efectivo = (sum(m.monto for m in datos.pagos if m.tipo_medio == "efectivo") if datos.tipo_medio == "mixto"
                else datos.precio_cobrado if datos.tipo_medio == "efectivo" else 0)
    if datos.valor_recibido is not None and efectivo > 0 and datos.valor_recibido < efectivo:
        raise OperacionInvalida("PAGO_INSUFICIENTE", "El efectivo recibido es menor que lo que se cobró en efectivo.")


async def _revisiones_de_precio(ctx: Contexto, datos: _PayloadCobro, precio_actual: int, que: str) -> List[Optional[Revision]]:
    revisiones: List[Optional[Revision]] = []
    if precio_actual != datos.precio_lista:
        revisiones.append(Revision(
            entidad="pagos_membresia", entidad_id=None, motivo_codigo="PRECIO_DISTINTO",
            motivo=f"La estación {ctx.estacion.nombre} cobró {que} con un precio distinto al actual. Se respetó el de la estación.",
            detalle={"precio_estacion": datos.precio_lista, "precio_actual": precio_actual},
        ))
    if datos.precio_cobrado < datos.precio_lista:
        regla = await _regla_descuento_actual(ctx)
        pct = _pct(datos.precio_lista, datos.precio_cobrado)
        if not regla["permitir"] or not regla["puede"] or pct > regla["tope"]:
            revisiones.append(Revision(
                entidad="pagos_membresia", entidad_id=None, motivo_codigo="DESCUENTO_FUERA_DE_REGLA",
                motivo=f"La estación {ctx.estacion.nombre} aplicó un descuento que la regla actual del gimnasio no permite.",
                detalle={"descuento_pct": float(pct), "tope_pct": float(regla["tope"]),
                         "descuentos_permitidos": regla["permitir"], "con_permiso": regla["puede"]},
            ))
    return revisiones


def _revision_deportista(ctx: Contexto, dep: dict, que: str) -> Optional[Revision]:
    if dep["activo"] and dep["deleted_at"] is None:
        return None
    return Revision(
        entidad="pagos_membresia", entidad_id=None, motivo_codigo="DEPORTISTA_DESACTIVADO",
        motivo=f"La estación {ctx.estacion.nombre} {que} a {dep['nombre']}, que en el sistema figura desactivado.",
        detalle={"deportista_id": str(dep["id"]), "deportista": dep["nombre"]},
    )


async def _insertar_pago(ctx: Contexto, datos: _PayloadCobro, turno_id: UUID, membresia_id: UUID, dias: int,
                         es_venta: bool, momento) -> None:
    gym_id = ctx.estacion.gimnasio_id
    motivo = (datos.motivo_descuento or "").strip() or None if datos.precio_cobrado < datos.precio_lista else None
    await ctx.session.execute(
        text("""
            INSERT INTO platform.pagos_membresia (
                id, gimnasio_id, turno_id, membresia_id, monto, metodo, tipo_medio, dias_agregados, idempotency_key,
                registrado_por, created_at, precio_lista, precio_cobrado, descuento_pct, motivo_descuento, es_venta, recibido_en
            ) VALUES (
                :id, :g, :t, :m, :monto, :metodo, :tipo_medio, :dias, :clave,
                :staff, :momento, :lista, :cobrado, :pct, :motivo, :es_venta, now()
            )
        """),
        {"id": ctx.op.id, "g": gym_id, "t": turno_id, "m": membresia_id, "monto": Decimal(datos.precio_cobrado),
         "metodo": datos.metodo.strip(), "tipo_medio": datos.tipo_medio, "dias": dias, "clave": ctx.op.idempotency_key,
         "staff": ctx.staff["id"], "momento": momento, "lista": Decimal(datos.precio_lista), "cobrado": Decimal(datos.precio_cobrado),
         "pct": _pct(datos.precio_lista, datos.precio_cobrado), "motivo": motivo, "es_venta": es_venta},
    )
    for m in datos.pagos:
        await ctx.session.execute(
            text("""INSERT INTO platform.cobro_medios (gimnasio_id, pago_membresia_id, metodo, tipo_medio, monto)
                    VALUES (:g, :p, :metodo, :tipo, :monto)"""),
            {"g": gym_id, "p": ctx.op.id, "metodo": m.metodo.strip(), "tipo": m.tipo_medio, "monto": Decimal(m.monto)},
        )


# ---------------------------------------------------------------------------
# membresia_renovar
# ---------------------------------------------------------------------------
async def renovar(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadRenovar, ctx, "La renovación")
    staff = _exigir_staff(ctx, "La renovación")
    _validar_cobro(datos)
    gym_id = ctx.estacion.gimnasio_id
    turno = await _turno_de_la_estacion(ctx, datos.turno_id)
    momento, revision_reloj = _hora(ctx, "pagos_membresia")
    dia = momento.astimezone(LOCAL_TZ).date()

    res = await ctx.session.execute(
        text("""
            SELECT m.id, m.deportista_id, m.fecha_vencimiento, m.cancelada, m.plan_precio_vendido,
                   p.nombre AS plan_nombre, p.precio AS plan_precio, p.duracion_dias AS plan_duracion,
                   d.nombre AS dep_nombre, d.activo AS dep_activo, d.deleted_at AS dep_deleted_at
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            JOIN platform.deportistas d ON d.id = m.deportista_id
            WHERE m.id = :m AND m.gimnasio_id = :g
            FOR UPDATE OF m
        """),
        {"m": datos.membresia_id, "g": gym_id},
    )
    memb = res.mappings().first()
    if memb is None:
        raise OperacionInvalida("MEMBRESIA_DESCONOCIDA", "La membresía que se renovó ya no existe en el sistema.")
    if memb["deportista_id"] != datos.deportista_id:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "La membresía renovada no es del cliente que dice la operación.")

    revisiones: List[Optional[Revision]] = [_revision_turno_cerrado(ctx, turno, "una renovación")]
    dep = {"id": memb["deportista_id"], "nombre": memb["dep_nombre"], "activo": memb["dep_activo"], "deleted_at": memb["dep_deleted_at"]}
    revisiones.append(_revision_deportista(ctx, dep, "le renovó la membresía"))

    precio_actual = int(round(memb["plan_precio_vendido"] if memb["plan_precio_vendido"] is not None else memb["plan_precio"]))
    revisiones += await _revisiones_de_precio(ctx, datos, precio_actual, "la renovación")

    venc_actual: date = memb["fecha_vencimiento"]
    dias = int(memb["plan_duracion"] or 30)  # misma regla que la web: la duración vigente del plan
    if memb["cancelada"]:
        # La membresía se canceló mientras la estación no tenía red: el pago se guarda, la vigencia no se toca.
        nueva, dias = venc_actual, 0
        revisiones.append(Revision(
            entidad="pagos_membresia", entidad_id=None, motivo_codigo="MEMBRESIA_CANCELADA",
            motivo=(f"La estación {ctx.estacion.nombre} renovó la membresía de {memb['dep_nombre']}, que ya estaba cancelada. "
                    "El pago quedó registrado y la vigencia no cambió."),
            detalle={"membresia_id": str(memb["id"])},
        ))
    else:
        res = await ctx.session.execute(text("SELECT dias_gracia_mora FROM platform.tenant WHERE id = :g"), {"g": gym_id})
        gracia_cfg = res.scalar()
        gracia = gracia_cfg if gracia_cfg is not None else 3
        en_gracia = False
        if venc_actual < dia:
            en_gracia = await CajaService.tuvo_checkin_en_gracia(ctx.session, gym_id, memb["deportista_id"], venc_actual, gracia)
        _, nueva = calcular_vencimiento_renovacion_c2(
            venc_actual=venc_actual, hoy=dia, dias_duracion=dias, dias_gracia_mora=gracia, tuvo_checkin_en_gracia=en_gracia,
        )
        await ctx.session.execute(
            text("UPDATE platform.membresias SET fecha_vencimiento = :f, updated_at = now() WHERE id = :m"),
            {"f": nueva, "m": memb["id"]},
        )
        if nueva != datos.fecha_vencimiento_nueva:
            revisiones.append(Revision(
                entidad="pagos_membresia", entidad_id=None, motivo_codigo="FECHA_RENOVACION_DISTINTA",
                motivo=(f"La estación {ctx.estacion.nombre} calculó que la membresía de {memb['dep_nombre']} vencía el "
                        f"{datos.fecha_vencimiento_nueva.isoformat()} y el servidor el {nueva.isoformat()}. Quedó la del servidor."),
                detalle={"fecha_estacion": datos.fecha_vencimiento_nueva.isoformat(), "fecha_servidor": nueva.isoformat(),
                         "vencimiento_anterior_estacion": datos.fecha_vencimiento_anterior.isoformat(),
                         "vencimiento_anterior_servidor": venc_actual.isoformat(), "dias_estacion": datos.dias, "dias_servidor": dias},
            ))

    await _insertar_pago(ctx, datos, turno["id"], memb["id"], dias, False, momento)
    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
        accion="RENOVAR_MEMBRESIA_ESTACION", entidad="pagos_membresia", entidad_id=str(ctx.op.id),
        detalle={"membresia_id": str(memb["id"]), "turno_id": str(turno["id"]), "monto": datos.precio_cobrado,
                 "tipo_medio": datos.tipo_medio, "vencimiento_anterior": venc_actual.isoformat(), "vencimiento_nuevo": nueva.isoformat(),
                 "estacion": ctx.estacion.nombre, "ocurrida_en": momento.isoformat(), "operacion_id": str(ctx.op.id)},
    )
    revisiones.append(await _permiso_caja(ctx, "crear", "una renovación"))
    revisiones.append(revision_reloj)
    revision = _unir(revisiones, "pagos_membresia", str(ctx.op.id))
    return Efecto(
        respuesta={"pago_id": str(ctx.op.id), "membresia_id": str(memb["id"]), "turno_id": str(turno["id"]),
                   "fecha_vencimiento": nueva.isoformat()},
        revision=revision,
    )


# ---------------------------------------------------------------------------
# membresia_vender
# ---------------------------------------------------------------------------
async def vender(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadVender, ctx, "La venta del plan")
    staff = _exigir_staff(ctx, "La venta del plan")
    _validar_cobro(datos)
    gym_id = ctx.estacion.gimnasio_id
    turno = await _turno_de_la_estacion(ctx, datos.turno_id)
    momento, revision_reloj = _hora(ctx, "pagos_membresia")
    dia = momento.astimezone(LOCAL_TZ).date()

    res = await ctx.session.execute(
        text("SELECT id, nombre, activo, deleted_at FROM platform.deportistas WHERE id = :d AND gimnasio_id = :g FOR UPDATE"),
        {"d": datos.deportista_id, "g": gym_id},
    )
    dep = res.mappings().first()
    if dep is None:
        raise OperacionInvalida("DEPORTISTA_DESCONOCIDO", "El cliente al que se le vendió el plan ya no existe en el sistema.")
    res = await ctx.session.execute(
        text("SELECT id, nombre, precio, duracion_dias, activo FROM platform.planes WHERE id = :p AND gimnasio_id = :g"),
        {"p": datos.plan_id, "g": gym_id},
    )
    plan = res.mappings().first()
    if plan is None:
        raise OperacionInvalida("PLAN_DESCONOCIDO", "El plan vendido ya no existe en el sistema.")
    res = await ctx.session.execute(
        text("SELECT 1 FROM platform.membresias WHERE id = :m"), {"m": datos.membresia_id},
    )
    if res.first():
        raise OperacionInvalida("MEMBRESIA_YA_EXISTE", "El id de la membresía vendida ya está en uso.")

    revisiones: List[Optional[Revision]] = [_revision_turno_cerrado(ctx, turno, "una venta de plan")]
    revisiones.append(_revision_deportista(ctx, dict(dep), "le vendió un plan"))
    if not plan["activo"]:
        revisiones.append(Revision(
            entidad="pagos_membresia", entidad_id=None, motivo_codigo="PLAN_INACTIVO",
            motivo=f"La estación {ctx.estacion.nombre} vendió el plan '{plan['nombre']}', que está desactivado.",
            detalle={"plan_id": str(plan["id"])},
        ))
    res = await ctx.session.execute(
        text("""SELECT id, fecha_vencimiento FROM platform.membresias
                WHERE gimnasio_id = :g AND deportista_id = :d AND cancelada = false
                ORDER BY fecha_vencimiento DESC LIMIT 1"""),
        {"g": gym_id, "d": dep["id"]},
    )
    previa = res.mappings().first()
    if previa:
        # Otra membresía llegó por otro lado mientras la estación no tenía red: se registra igual.
        revisiones.append(Revision(
            entidad="pagos_membresia", entidad_id=None, motivo_codigo="MEMBRESIA_YA_EXISTIA",
            motivo=(f"La estación {ctx.estacion.nombre} le vendió un plan a {dep['nombre']}, que ya tenía una membresía "
                    f"sin cancelar (vence el {previa['fecha_vencimiento'].isoformat()}). Quedaron las dos."),
            detalle={"membresia_previa_id": str(previa["id"])},
        ))
    revisiones += await _revisiones_de_precio(ctx, datos, int(round(plan["precio"])), "el plan")

    dias = int(plan["duracion_dias"])
    inicio, vence = dia, dia + timedelta(days=dias)
    if (inicio, vence) != (datos.fecha_inicio, datos.fecha_vencimiento):
        revisiones.append(Revision(
            entidad="pagos_membresia", entidad_id=None, motivo_codigo="FECHA_RENOVACION_DISTINTA",
            motivo=(f"La estación {ctx.estacion.nombre} calculó que el plan de {dep['nombre']} iba del "
                    f"{datos.fecha_inicio.isoformat()} al {datos.fecha_vencimiento.isoformat()} y el servidor del "
                    f"{inicio.isoformat()} al {vence.isoformat()}. Quedó la del servidor."),
            detalle={"inicio_estacion": datos.fecha_inicio.isoformat(), "vence_estacion": datos.fecha_vencimiento.isoformat(),
                     "inicio_servidor": inicio.isoformat(), "vence_servidor": vence.isoformat()},
        ))

    await ctx.session.execute(
        text("""
            INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada,
                                             plan_precio_vendido, plan_duracion_dias_vendida, created_at)
            VALUES (:id, :g, :d, :p, :ini, :fin, false, :precio, :dias, :momento)
        """),
        {"id": datos.membresia_id, "g": gym_id, "d": dep["id"], "p": plan["id"], "ini": inicio, "fin": vence,
         "precio": Decimal(datos.precio_lista), "dias": dias, "momento": momento},
    )
    await _insertar_pago(ctx, datos, turno["id"], datos.membresia_id, dias, True, momento)
    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
        accion="ASIGNAR_MEMBRESIA_ESTACION", entidad="membresias", entidad_id=str(datos.membresia_id),
        detalle={"plan_nombre": plan["nombre"], "fecha_inicio": inicio.isoformat(), "fecha_vencimiento": vence.isoformat(),
                 "pago_id": str(ctx.op.id), "monto": datos.precio_cobrado, "turno_id": str(turno["id"]),
                 "estacion": ctx.estacion.nombre, "ocurrida_en": momento.isoformat(), "operacion_id": str(ctx.op.id)},
    )
    revisiones.append(await _permiso_caja(ctx, "crear", "una venta de plan"))
    revisiones.append(revision_reloj)
    revision = _unir(revisiones, "pagos_membresia", str(ctx.op.id))
    return Efecto(
        respuesta={"pago_id": str(ctx.op.id), "membresia_id": str(datos.membresia_id), "turno_id": str(turno["id"]),
                   "fecha_inicio": inicio.isoformat(), "fecha_vencimiento": vence.isoformat()},
        revision=revision,
    )
