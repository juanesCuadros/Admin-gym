"""
Caja de la estación (fase 3A): tipos `turno_abrir`, `venta`, `egreso` y `turno_cerrar` de `/sync/push`.

Reglas (ALCANCE_APP_ESCRITORIO.md §5.1 y decisiones del 22-nov-2026, A1 a A3):
- El dinero cobrado sin red nunca se pierde. Un conflicto de negocio no rechaza la operación: se registra
  igual y queda por revisar con su motivo. Solo un contenido mal formado (error de programación) es inválido.
- Los ids vienen de la estación: el turno, la venta y el egreso usan el id de su operación. Así el turno
  de la estación y el del servidor son el mismo, movimiento por movimiento.
- Un turno abierto en una estación es de esa estación. Si al llegar ya había (o hubo mientras tanto) otro
  turno abierto en el gimnasio, se registra igual como "turno simultáneo". Cada uno se cierra con su arqueo.
- Si el Jefe cerró a la fuerza el turno de la estación, lo que ella siga cobrando se registra en ese
  turno y queda por revisar: el efectivo está en esa caja.
- Precio: se respeta el que tenía la estación y se marca si difiere del actual. Stock: se descuenta aunque
  quede negativo y se marca. Descuento fuera de la regla vigente: se registra y se marca.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.modules.caja.service import CajaService
from app.modules.sync.dependencias import EstacionAutenticada
from app.modules.sync.ingresos import hora_del_ingreso
from app.modules.sync.push import Contexto, Efecto, OperacionInvalida, Revision

MAX_MONTO = 100_000_000  # 100 millones de pesos: más que eso en un solo movimiento es un error de digitación.


# ---------------------------------------------------------------------------
# Contenido de cada tipo (pesos colombianos enteros, como los guarda la estación)
# ---------------------------------------------------------------------------
class _PayloadAbrir(BaseModel):
    base_inicial: int = Field(..., ge=0, le=MAX_MONTO)
    # La estación abrió sin poder confirmar con el servidor que no hubiera otro turno abierto.
    sin_confirmar: bool = False


class _Medio(BaseModel):
    metodo: str = Field(..., min_length=2, max_length=50)
    tipo_medio: Literal["efectivo", "otro"]
    monto: int = Field(..., gt=0, le=MAX_MONTO)


class _Item(BaseModel):
    tipo: Literal["producto", "pase_dia", "pase_clase"]
    producto_id: Optional[UUID] = None
    descripcion: str = Field(..., min_length=1, max_length=200)
    cantidad: int = Field(..., ge=1, le=1000)
    precio_lista: int = Field(..., ge=0, le=MAX_MONTO)
    precio_cobrado: int = Field(..., ge=0, le=MAX_MONTO)
    motivo_descuento: Optional[str] = Field(None, max_length=255)


class _PayloadVenta(BaseModel):
    turno_id: UUID
    deportista_id: Optional[UUID] = None
    items: List[_Item] = Field(..., min_length=1, max_length=50)
    total: int = Field(..., ge=0, le=MAX_MONTO)
    tipo_medio: Literal["efectivo", "otro", "mixto"]
    metodo: str = Field(..., min_length=2, max_length=50)
    pagos: List[_Medio] = Field(default_factory=list, max_length=5)
    valor_recibido: Optional[int] = Field(None, ge=0, le=MAX_MONTO)


class _PayloadEgreso(BaseModel):
    turno_id: UUID
    monto: int = Field(..., gt=0, le=MAX_MONTO)
    motivo: str = Field(..., min_length=4, max_length=255)


class _PayloadCerrar(BaseModel):
    turno_id: UUID
    efectivo_contado: int = Field(..., ge=0, le=MAX_MONTO)
    # Lo que la estación calculó, para comparar peso por peso con el servidor.
    total_esperado_efectivo: int
    nota: Optional[str] = Field(None, max_length=500)


def _leer(modelo, ctx: Contexto, que: str):
    try:
        return modelo(**ctx.op.payload)
    except ValidationError:
        raise OperacionInvalida("PAYLOAD_INVALIDO", f"{que} no trae los datos esperados.")


def _exigir_staff(ctx: Contexto, que: str) -> dict:
    if ctx.staff is None:
        raise OperacionInvalida("STAFF_REQUERIDO", f"{que} no dice quién lo registró.")
    return ctx.staff


# ---------------------------------------------------------------------------
# Revisiones
# ---------------------------------------------------------------------------
def _hora(ctx: Contexto, entidad: str) -> tuple[datetime, Optional[Revision]]:
    """La misma regla de reloj de los ingresos (E-28): hasta 5 minutos se acepta la hora de la estación."""
    momento, revision = hora_del_ingreso(ctx)
    if revision:
        revision.entidad = entidad
    return momento, revision


async def _permiso_caja(ctx: Contexto, accion: str, que: str) -> Optional[Revision]:
    """Quien registró debe seguir activo y con permiso de caja. Si no, se registra igual y queda por revisar."""
    staff = ctx.staff
    if not staff["activo"] or staff["deleted_at"] is not None:
        return Revision(
            entidad="staff", entidad_id=str(staff["id"]), motivo_codigo="STAFF_DESACTIVADO",
            motivo=f"{staff['nombre']} registró {que} en la estación {ctx.estacion.nombre} y en el sistema figura desactivado.",
        )
    if staff["rol"] == "jefe":
        return None
    columna = {"crear": "puede_crear", "editar": "puede_editar"}[accion]
    res = await ctx.session.execute(
        text(f"SELECT {columna} FROM platform.permisos_rol WHERE gimnasio_id = :g AND rol = :rol AND submodulo = 'caja'"),
        {"g": ctx.estacion.gimnasio_id, "rol": staff["rol"]},
    )
    if not res.scalar_one_or_none():  # sin fila de permiso, no lo tiene (fail-closed)
        return Revision(
            entidad="staff", entidad_id=str(staff["id"]), motivo_codigo="STAFF_SIN_PERMISO",
            motivo=f"{staff['nombre']} registró {que} en la estación {ctx.estacion.nombre} sin tener permiso de caja.",
        )
    return None


def _unir(revisiones: List[Optional[Revision]], entidad: str, entidad_id: str) -> Optional[Revision]:
    """Una operación deja una sola revisión, sobre el movimiento; los demás motivos van en su detalle."""
    reales = [r for r in revisiones if r is not None]
    if not reales:
        return None
    principal = reales[0]
    otros = [{"motivo_codigo": r.motivo_codigo, "motivo": r.motivo, **r.detalle} for r in reales[1:]]
    detalle = dict(principal.detalle)
    if principal.entidad != entidad:
        detalle[f"{principal.entidad}_id"] = principal.entidad_id
    if otros:
        detalle["otros_motivos"] = otros
    return Revision(entidad=entidad, entidad_id=entidad_id, motivo_codigo=principal.motivo_codigo, motivo=principal.motivo, detalle=detalle)


async def _turno_de_la_estacion(ctx: Contexto, turno_id: UUID) -> dict:
    res = await ctx.session.execute(
        text("""
            SELECT id, staff_id, base_inicial, abierto_en, estado, cierre_forzado, cerrado_en
            FROM platform.turnos_caja
            WHERE id = :t AND gimnasio_id = :g AND estacion_id = :e
            FOR UPDATE
        """),
        {"t": turno_id, "g": ctx.estacion.gimnasio_id, "e": ctx.estacion.id},
    )
    turno = res.mappings().first()
    if not turno:
        raise OperacionInvalida("TURNO_DESCONOCIDO", "El turno de caja de esta operación no es de esta estación o no ha llegado.")
    return dict(turno)


def _revision_turno_cerrado(ctx: Contexto, turno: dict, que: str) -> Optional[Revision]:
    if turno["estado"] == "abierto":
        return None
    forma = "a la fuerza" if turno["cierre_forzado"] else "en el servidor"
    return Revision(
        entidad="turnos_caja", entidad_id=str(turno["id"]), motivo_codigo="TURNO_CERRADO_EN_SERVIDOR",
        motivo=f"La estación {ctx.estacion.nombre} registró {que} en un turno que ya se había cerrado {forma}.",
        detalle={"turno_id": str(turno["id"]), "cerrado_en": turno["cerrado_en"].isoformat() if turno["cerrado_en"] else None},
    )


# ---------------------------------------------------------------------------
# turno_abrir
# ---------------------------------------------------------------------------
async def turno_abrir(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadAbrir, ctx, "La apertura de turno")
    staff = _exigir_staff(ctx, "La apertura de turno")
    gym_id = ctx.estacion.gimnasio_id
    momento, revision_reloj = _hora(ctx, "turnos_caja")

    await CajaService.bloquear_apertura(ctx.session, gym_id)
    res = await ctx.session.execute(
        text("SELECT id FROM platform.turnos_caja WHERE estacion_id = :e AND estado = 'abierto' AND id <> :id"),
        {"e": ctx.estacion.id, "id": ctx.op.id},
    )
    if res.first():
        # La estación solo tiene un turno abierto a la vez: otro abierto aquí es un error de la estación.
        raise OperacionInvalida("TURNO_YA_ABIERTO_EN_ESTACION", "Esta estación ya tiene otro turno abierto en el servidor.")

    # Otro turno del gimnasio abierto al mismo tiempo (ahora o mientras la estación estuvo sin red).
    res = await ctx.session.execute(
        text("""
            SELECT t.id, t.abierto_en, t.cerrado_en, t.estado, s.nombre AS staff_nombre, e.nombre AS estacion_nombre
            FROM platform.turnos_caja t
            JOIN platform.staff s ON s.id = t.staff_id
            LEFT JOIN platform.estaciones e ON e.id = t.estacion_id
            WHERE t.gimnasio_id = :g AND t.id <> :id
              AND t.abierto_en <= now()
              AND (t.estado = 'abierto' OR t.cerrado_en > :desde)
            ORDER BY t.abierto_en
        """),
        {"g": gym_id, "id": ctx.op.id, "desde": momento},
    )
    otros = [dict(f) for f in res.mappings().all()]

    await ctx.session.execute(
        text("""
            INSERT INTO platform.turnos_caja (id, gimnasio_id, staff_id, base_inicial, estado, abierto_en, estacion_id)
            VALUES (:id, :g, :staff, :base, 'abierto', :abierto, :e)
        """),
        {"id": ctx.op.id, "g": gym_id, "staff": staff["id"], "base": Decimal(datos.base_inicial), "abierto": momento, "e": ctx.estacion.id},
    )
    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
        accion="ABRIR_TURNO_CAJA", entidad="turnos_caja", entidad_id=str(ctx.op.id),
        detalle={"base_inicial": datos.base_inicial, "estacion": ctx.estacion.nombre, "abierto_en": momento.isoformat(),
                 "sin_confirmar": datos.sin_confirmar, "operacion_id": str(ctx.op.id)},
    )

    simultaneo = None
    if otros:
        donde = lambda o: f"la estación {o['estacion_nombre']}" if o["estacion_nombre"] else "la web"  # noqa: E731
        simultaneo = Revision(
            entidad="turnos_caja", entidad_id=str(ctx.op.id), motivo_codigo="TURNO_SIMULTANEO",
            motivo=(f"La estación {ctx.estacion.nombre} abrió su turno sin red mientras había otro turno abierto en "
                    f"{donde(otros[0])} ({otros[0]['staff_nombre']}). Cada turno se cierra con su propio arqueo."),
            detalle={"otros_turnos": [
                {"turno_id": str(o["id"]), "donde": donde(o), "abierto_por": o["staff_nombre"], "abierto_en": o["abierto_en"].isoformat(),
                 "estado": o["estado"]} for o in otros
            ], "sin_confirmar": datos.sin_confirmar},
        )
    revision = _unir([simultaneo, await _permiso_caja(ctx, "crear", "una apertura de caja"), revision_reloj], "turnos_caja", str(ctx.op.id))
    return Efecto(respuesta={"turno_id": str(ctx.op.id), "abierto_en": momento.isoformat()}, revision=revision)


# ---------------------------------------------------------------------------
# venta
# ---------------------------------------------------------------------------
def _validar_venta(datos: _PayloadVenta) -> None:
    """Lo que la estación nunca debería mandar: es un error de programación, no un conflicto."""
    if sum(it.precio_cobrado * it.cantidad for it in datos.items) != datos.total:
        raise OperacionInvalida("TOTAL_NO_CUADRA", "La suma de los ítems no da el total de la venta.")
    for it in datos.items:
        if it.tipo == "producto" and it.producto_id is None:
            raise OperacionInvalida("PRODUCTO_ID_REQUERIDO", "Un producto de la venta no dice cuál es.")
        if it.tipo != "producto" and it.producto_id is not None:
            raise OperacionInvalida("PAYLOAD_INVALIDO", "Un pase no lleva producto.")
        if it.precio_cobrado < it.precio_lista and not (it.motivo_descuento or "").strip():
            raise OperacionInvalida("MOTIVO_DESCUENTO_REQUERIDO", "Un descuento de la venta no trae motivo.")
    if any(it.tipo == "pase_dia" for it in datos.items) and datos.deportista_id is None:
        raise OperacionInvalida("PASE_DIA_REQUIERE_CLIENTE", "El pase de día de la venta no dice para qué cliente es.")
    if datos.tipo_medio == "mixto":
        if len(datos.pagos) < 2 or sum(m.monto for m in datos.pagos) != datos.total:
            raise OperacionInvalida("MEDIOS_NO_SUMAN_TOTAL", "Los medios del pago mixto no suman el total.")
    elif datos.pagos:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "Solo un pago mixto trae el reparto por medios.")
    efectivo = _parte_efectivo(datos)
    if datos.valor_recibido is not None and efectivo > 0 and datos.valor_recibido < efectivo:
        raise OperacionInvalida("PAGO_INSUFICIENTE", "El efectivo recibido es menor que lo que se cobró en efectivo.")


def _parte_efectivo(datos: _PayloadVenta) -> int:
    if datos.tipo_medio == "mixto":
        return sum(m.monto for m in datos.pagos if m.tipo_medio == "efectivo")
    return datos.total if datos.tipo_medio == "efectivo" else 0


async def _regla_descuento_actual(ctx: Contexto) -> Dict[str, Any]:
    res = await ctx.session.execute(
        text("SELECT permitir_descuentos, tope_descuento_pct, precio_pase_dia, precio_pase_clase FROM platform.tenant WHERE id = :g"),
        {"g": ctx.estacion.gimnasio_id},
    )
    t = dict(res.mappings().one())
    puede = ctx.staff["rol"] == "jefe"
    if not puede:
        res = await ctx.session.execute(
            text("SELECT puede_editar FROM platform.permisos_rol WHERE gimnasio_id = :g AND rol = :rol AND submodulo = 'caja'"),
            {"g": ctx.estacion.gimnasio_id, "rol": ctx.staff["rol"]},
        )
        puede = bool(res.scalar_one_or_none())
    return {
        "permitir": bool(t["permitir_descuentos"]),
        "tope": Decimal(str(t["tope_descuento_pct"])) if t["tope_descuento_pct"] is not None else Decimal("0"),
        "puede": puede,
        "pase_dia": int(t["precio_pase_dia"]) if t["precio_pase_dia"] is not None else None,
        "pase_clase": int(t["precio_pase_clase"]) if t["precio_pase_clase"] is not None else None,
    }


def _pct(lista: int, cobrado: int) -> Decimal:
    if lista <= 0 or cobrado >= lista:
        return Decimal("0")
    return round((Decimal(lista - cobrado) / Decimal(lista)) * Decimal("100"), 2)


async def venta(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadVenta, ctx, "La venta")
    staff = _exigir_staff(ctx, "La venta")
    _validar_venta(datos)
    gym_id = ctx.estacion.gimnasio_id
    venta_id = ctx.op.id
    turno = await _turno_de_la_estacion(ctx, datos.turno_id)
    momento, revision_reloj = _hora(ctx, "ventas")
    revisiones: List[Optional[Revision]] = [_revision_turno_cerrado(ctx, turno, "una venta")]

    # Cliente: si ya no existe, la venta se guarda sin él; si está desactivado, se guarda y se marca.
    deportista_id = datos.deportista_id
    if deportista_id is not None:
        res = await ctx.session.execute(
            text("SELECT id, nombre, activo, deleted_at FROM platform.deportistas WHERE id = :d AND gimnasio_id = :g"),
            {"d": deportista_id, "g": gym_id},
        )
        dep = res.mappings().first()
        if dep is None:
            revisiones.append(Revision(
                entidad="ventas", entidad_id=None, motivo_codigo="DEPORTISTA_DESCONOCIDO",
                motivo=f"La estación {ctx.estacion.nombre} vendió a un cliente que ya no existe en el sistema.",
                detalle={"deportista_id": str(deportista_id)},
            ))
            deportista_id = None
        elif not dep["activo"] or dep["deleted_at"] is not None:
            revisiones.append(Revision(
                entidad="ventas", entidad_id=None, motivo_codigo="DEPORTISTA_DESACTIVADO",
                motivo=f"La estación {ctx.estacion.nombre} le vendió a {dep['nombre']}, que en el sistema figura desactivado.",
                detalle={"deportista_id": str(deportista_id), "deportista": dep["nombre"]},
            ))

    # Productos: se bloquean en orden (como en la web) y se respeta el precio de la estación.
    ids = sorted({it.producto_id for it in datos.items if it.tipo == "producto"})
    productos: Dict[UUID, dict] = {}
    if ids:
        res = await ctx.session.execute(
            text("SELECT id, nombre, precio, stock, activo FROM platform.productos WHERE gimnasio_id = :g AND id = ANY(:ids) ORDER BY id FOR UPDATE"),
            {"g": gym_id, "ids": ids},
        )
        productos = {f["id"]: dict(f) for f in res.mappings().all()}
        faltan = [str(i) for i in ids if i not in productos]
        if faltan:
            raise OperacionInvalida("PRODUCTO_DESCONOCIDO", "Un producto de la venta no existe en este gimnasio.")

    regla = await _regla_descuento_actual(ctx)
    precios_distintos, descuentos_fuera = [], []
    for it in datos.items:
        if it.tipo == "producto":
            actual = int(productos[it.producto_id]["precio"])
            if actual != it.precio_lista:
                precios_distintos.append({"descripcion": it.descripcion, "precio_estacion": it.precio_lista, "precio_actual": actual})
            if not productos[it.producto_id]["activo"]:
                revisiones.append(Revision(
                    entidad="ventas", entidad_id=None, motivo_codigo="PRODUCTO_INACTIVO",
                    motivo=f"La estación {ctx.estacion.nombre} vendió '{productos[it.producto_id]['nombre']}', que está desactivado.",
                    detalle={"producto_id": str(it.producto_id)},
                ))
        else:
            configurado = regla[it.tipo]
            if configurado is not None and configurado != it.precio_lista:
                precios_distintos.append({"descripcion": it.descripcion, "precio_estacion": it.precio_lista, "precio_actual": configurado})
        if it.precio_cobrado < it.precio_lista:
            pct = _pct(it.precio_lista, it.precio_cobrado)
            if not regla["permitir"] or not regla["puede"] or pct > regla["tope"]:
                descuentos_fuera.append({"descripcion": it.descripcion, "descuento_pct": float(pct), "tope_pct": float(regla["tope"]),
                                         "descuentos_permitidos": regla["permitir"], "con_permiso": regla["puede"]})
    if precios_distintos:
        revisiones.append(Revision(
            entidad="ventas", entidad_id=None, motivo_codigo="PRECIO_DISTINTO",
            motivo=f"La estación {ctx.estacion.nombre} cobró con un precio distinto al actual. Se respetó el de la estación.",
            detalle={"items": precios_distintos},
        ))
    if descuentos_fuera:
        revisiones.append(Revision(
            entidad="ventas", entidad_id=None, motivo_codigo="DESCUENTO_FUERA_DE_REGLA",
            motivo=f"La estación {ctx.estacion.nombre} aplicó un descuento que la regla actual del gimnasio no permite.",
            detalle={"items": descuentos_fuera},
        ))

    await ctx.session.execute(
        text("""
            INSERT INTO platform.ventas (id, gimnasio_id, turno_id, deportista_id, total, metodo, tipo_medio, valor_recibido,
                                         idempotency_key, registrada_por, created_at, recibida_en)
            VALUES (:id, :g, :t, :d, :total, :metodo, :tipo_medio, :recibido, :clave, :staff, :momento, now())
        """),
        {"id": venta_id, "g": gym_id, "t": turno["id"], "d": deportista_id, "total": Decimal(datos.total), "metodo": datos.metodo.strip(),
         "tipo_medio": datos.tipo_medio, "recibido": Decimal(datos.valor_recibido) if datos.valor_recibido is not None else None,
         "clave": ctx.op.idempotency_key, "staff": staff["id"], "momento": momento},
    )
    for m in datos.pagos:
        await ctx.session.execute(
            text("""INSERT INTO platform.cobro_medios (gimnasio_id, venta_id, metodo, tipo_medio, monto)
                    VALUES (:g, :v, :metodo, :tipo, :monto)"""),
            {"g": gym_id, "v": venta_id, "metodo": m.metodo.strip(), "tipo": m.tipo_medio, "monto": Decimal(m.monto)},
        )

    negativos = []
    for it in datos.items:
        await ctx.session.execute(
            text("""
                INSERT INTO platform.venta_items (gimnasio_id, venta_id, tipo, producto_id, descripcion, cantidad, precio_unitario, subtotal,
                                                  precio_lista, precio_cobrado, descuento_pct, motivo_descuento)
                VALUES (:g, :v, :tipo, :p, :desc, :cant, :cobrado, :subtotal, :lista, :cobrado, :pct, :motivo)
            """),
            {"g": gym_id, "v": venta_id, "tipo": it.tipo, "p": it.producto_id, "desc": it.descripcion.strip(), "cant": it.cantidad,
             "cobrado": Decimal(it.precio_cobrado), "subtotal": Decimal(it.precio_cobrado * it.cantidad), "lista": Decimal(it.precio_lista),
             "pct": _pct(it.precio_lista, it.precio_cobrado),
             "motivo": (it.motivo_descuento or "").strip() or None if it.precio_cobrado < it.precio_lista else None},
        )
        if it.tipo == "producto":
            res = await ctx.session.execute(
                text("UPDATE platform.productos SET stock = stock - :c, updated_at = now() WHERE id = :p AND gimnasio_id = :g RETURNING stock"),
                {"c": it.cantidad, "p": it.producto_id, "g": gym_id},
            )
            stock = res.scalar_one()
            await ctx.session.execute(
                text("""INSERT INTO platform.stock_movimientos (gimnasio_id, producto_id, tipo, cantidad, motivo, registrado_por, created_at)
                        VALUES (:g, :p, 'venta', :c, :motivo, :staff, :momento)"""),
                {"g": gym_id, "p": it.producto_id, "c": -it.cantidad, "motivo": f"Venta en la estación {ctx.estacion.nombre} {venta_id}",
                 "staff": staff["id"], "momento": momento},
            )
            if stock < 0:
                negativos.append({"producto_id": str(it.producto_id), "producto": productos[it.producto_id]["nombre"], "stock": stock})
    if negativos:
        revisiones.append(Revision(
            entidad="ventas", entidad_id=None, motivo_codigo="STOCK_NEGATIVO",
            motivo=(f"La estación {ctx.estacion.nombre} vendió más unidades de las que había: "
                    + ", ".join(f"{n['producto']} quedó en {n['stock']}" for n in negativos) + "."),
            detalle={"productos": negativos},
        ))

    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
        accion="REGISTRAR_VENTA_ESTACION", entidad="ventas", entidad_id=str(venta_id),
        detalle={"turno_id": str(turno["id"]), "total": datos.total, "tipo_medio": datos.tipo_medio, "items": len(datos.items),
                 "estacion": ctx.estacion.nombre, "ocurrida_en": momento.isoformat(), "operacion_id": str(ctx.op.id)},
    )
    revisiones.append(await _permiso_caja(ctx, "crear", "una venta"))
    revisiones.append(revision_reloj)
    revision = _unir(revisiones, "ventas", str(venta_id))
    return Efecto(respuesta={"venta_id": str(venta_id), "turno_id": str(turno["id"]), "created_at": momento.isoformat()}, revision=revision)


# ---------------------------------------------------------------------------
# egreso
# ---------------------------------------------------------------------------
async def egreso(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadEgreso, ctx, "El egreso")
    staff = _exigir_staff(ctx, "El egreso")
    motivo = datos.motivo.strip()
    if len(motivo) < 4:
        raise OperacionInvalida("PAYLOAD_INVALIDO", "El egreso no trae un motivo válido (mínimo 4 letras).")
    gym_id = ctx.estacion.gimnasio_id
    turno = await _turno_de_la_estacion(ctx, datos.turno_id)
    momento, revision_reloj = _hora(ctx, "egresos_caja")
    await ctx.session.execute(
        text("""
            INSERT INTO platform.egresos_caja (id, gimnasio_id, turno_id, motivo, monto, registrado_por, created_at, recibido_en)
            VALUES (:id, :g, :t, :motivo, :monto, :staff, :momento, now())
        """),
        {"id": ctx.op.id, "g": gym_id, "t": turno["id"], "motivo": motivo, "monto": Decimal(datos.monto), "staff": staff["id"], "momento": momento},
    )
    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
        accion="REGISTRAR_EGRESO_CAJA", entidad="egresos_caja", entidad_id=str(ctx.op.id),
        detalle={"turno_id": str(turno["id"]), "monto": datos.monto, "motivo": motivo, "estacion": ctx.estacion.nombre,
                 "ocurrida_en": momento.isoformat(), "operacion_id": str(ctx.op.id)},
    )
    revision = _unir(
        [_revision_turno_cerrado(ctx, turno, "un egreso"), await _permiso_caja(ctx, "crear", "un egreso"), revision_reloj],
        "egresos_caja", str(ctx.op.id),
    )
    return Efecto(respuesta={"egreso_id": str(ctx.op.id), "turno_id": str(turno["id"])}, revision=revision)


# ---------------------------------------------------------------------------
# turno_cerrar
# ---------------------------------------------------------------------------
async def turno_cerrar(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadCerrar, ctx, "El cierre de turno")
    staff = _exigir_staff(ctx, "El cierre de turno")
    gym_id = ctx.estacion.gimnasio_id
    turno = await _turno_de_la_estacion(ctx, datos.turno_id)
    momento, revision_reloj = _hora(ctx, "turnos_caja")
    res = await ctx.session.execute(
        text("SELECT t.*, s.nombre AS staff_nombre FROM platform.turnos_caja t JOIN platform.staff s ON s.id = t.staff_id WHERE t.id = :t"),
        {"t": turno["id"]},
    )
    fila = dict(res.mappings().one())
    resumen = await CajaService._calcular_acumulados_turno(ctx.session, fila)
    esperado = int(resumen.total_esperado_efectivo)

    if turno["estado"] != "abierto":
        # P-11: el turno cerrado no se toca. El arqueo de la estación queda en la revisión.
        revision = Revision(
            entidad="turnos_caja", entidad_id=str(turno["id"]), motivo_codigo="TURNO_CERRADO_EN_SERVIDOR",
            motivo=(f"La estación {ctx.estacion.nombre} cerró su turno con {datos.efectivo_contado:,} contados, pero el turno ya se "
                    f"había cerrado {'a la fuerza' if turno['cierre_forzado'] else 'en el servidor'}.").replace(",", "."),
            detalle={"efectivo_contado_estacion": datos.efectivo_contado, "total_esperado_estacion": datos.total_esperado_efectivo,
                     "total_esperado_servidor": esperado, "cerrado_en_estacion": momento.isoformat()},
        )
        await AuditService.registrar(
            session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
            accion="CIERRE_TURNO_ESTACION_TARDIO", entidad="turnos_caja", entidad_id=str(turno["id"]),
            detalle={"efectivo_contado": datos.efectivo_contado, "estacion": ctx.estacion.nombre, "operacion_id": str(ctx.op.id)},
        )
        return Efecto(respuesta={"turno_id": str(turno["id"]), "estado": "ya_cerrado", "total_esperado_efectivo": esperado}, revision=revision)

    diferencia = datos.efectivo_contado - esperado
    await ctx.session.execute(
        text("""
            UPDATE platform.turnos_caja
            SET estado = 'cerrado', cerrado_en = :momento, efectivo_contado = :contado, diferencia = :dif,
                cerrado_por = :staff, nota_cierre = :nota
            WHERE id = :t
        """),
        {"momento": max(momento, turno["abierto_en"]), "contado": Decimal(datos.efectivo_contado), "dif": Decimal(diferencia),
         "staff": staff["id"], "nota": (datos.nota or "").strip() or None, "t": turno["id"]},
    )
    await AuditService.registrar(
        session=ctx.session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
        accion="CERRAR_TURNO_CAJA", entidad="turnos_caja", entidad_id=str(turno["id"]),
        detalle={"total_esperado_efectivo": esperado, "efectivo_contado": datos.efectivo_contado, "diferencia": diferencia,
                 "descuadre": diferencia != 0, "estacion": ctx.estacion.nombre, "operacion_id": str(ctx.op.id)},
    )
    no_coincide = None
    if esperado != datos.total_esperado_efectivo:
        no_coincide = Revision(
            entidad="turnos_caja", entidad_id=str(turno["id"]), motivo_codigo="RESUMEN_NO_COINCIDE",
            motivo=(f"El efectivo esperado del turno de la estación {ctx.estacion.nombre} no coincide: la estación calculó "
                    f"{datos.total_esperado_efectivo:,} y el servidor {esperado:,}.").replace(",", "."),
            detalle={"total_esperado_estacion": datos.total_esperado_efectivo, "total_esperado_servidor": esperado},
        )
    revision = _unir([no_coincide, await _permiso_caja(ctx, "crear", "un cierre de caja"), revision_reloj], "turnos_caja", str(turno["id"]))
    return Efecto(
        respuesta={"turno_id": str(turno["id"]), "estado": "cerrado", "total_esperado_efectivo": esperado, "diferencia": diferencia},
        revision=revision,
    )


# ---------------------------------------------------------------------------
# Consulta en línea antes de abrir (A1: con red, nada cambia)
# ---------------------------------------------------------------------------
class TurnoAbiertoDto(BaseModel):
    abierto: bool
    turno_id: Optional[UUID] = None
    es_de_esta_estacion: bool = False
    donde: Optional[str] = None
    abierto_por_nombre: Optional[str] = None
    abierto_en: Optional[datetime] = None
    consultado_en: datetime


async def turno_abierto(session: AsyncSession, estacion: EstacionAutenticada) -> TurnoAbiertoDto:
    res = await session.execute(
        text("""
            SELECT t.id, t.estacion_id, t.abierto_en, s.nombre AS staff_nombre, e.nombre AS estacion_nombre
            FROM platform.turnos_caja t
            JOIN platform.staff s ON s.id = t.staff_id
            LEFT JOIN platform.estaciones e ON e.id = t.estacion_id
            WHERE t.gimnasio_id = :g AND t.estado = 'abierto'
            ORDER BY (t.estacion_id = :e) DESC NULLS LAST, t.abierto_en
            LIMIT 1
        """),
        {"g": estacion.gimnasio_id, "e": estacion.id},
    )
    fila = res.mappings().first()
    ahora = datetime.now(timezone.utc)
    if not fila:
        return TurnoAbiertoDto(abierto=False, consultado_en=ahora)
    return TurnoAbiertoDto(
        abierto=True, turno_id=fila["id"], es_de_esta_estacion=fila["estacion_id"] == estacion.id,
        donde=f"la estación {fila['estacion_nombre']}" if fila["estacion_nombre"] else "la web",
        abierto_por_nombre=fila["staff_nombre"], abierto_en=fila["abierto_en"], consultado_en=ahora,
    )
