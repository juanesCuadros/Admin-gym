import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

from app.core.audit import AuditService
from app.core.timezone import now_local, today_local
from app.modules.caja.schemas import (
    AbrirTurnoRequest,
    AnularPagoMembresiaRequest,
    AnularVentaRequest,
    CerrarTurnoRequest,
    EgresoResponseDto,
    HistorialMovimientosTurnoResponse,
    MovimientoCajaItemDto,
    PagoMembresiaResponseDto,
    RegistrarEgresoRequest,
    RegistrarPagoMembresiaRequest,
    RegistrarVentaRequest,
    TurnoResumenDto,
    VentaItemResponseDto,
    VentaResponseDto,
)

logger = logging.getLogger(__name__)


class CajaService:
    """Orquestador de turnos de caja, punto de venta atómico, control de inventario e idempotencia."""

    # =========================================================================
    # 1. GESTIÓN DE TURNOS DE CAJA (RF-08, RF-09, RF-10)
    # =========================================================================

    @classmethod
    async def abrir_turno(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        data: AbrirTurnoRequest
    ) -> TurnoResumenDto:
        # 1. Validar que no tenga turno abierto previo
        check_query = text("""
            SELECT id FROM platform.turnos_caja
            WHERE staff_id = :staff_id AND estado = 'abierto'
        """)
        res_check = await session.execute(check_query, {"staff_id": staff_id})
        if res_check.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "TURNO_YA_ABIERTO", "mensaje": "Ya posee un turno de caja abierto actualmente"}
            )

        # 2. Inserción con Savepoint para prevenir condiciones de carrera (TOCTOU) ante requests simultáneos
        try:
            async with session.begin_nested():
                insert_query = text("""
                    INSERT INTO platform.turnos_caja (
                        gimnasio_id, staff_id, base_inicial, estado, abierto_en
                    ) VALUES (
                        :gym_id, :staff_id, :base_inicial, 'abierto', now()
                    ) RETURNING id, abierto_en
                """)
                res_insert = await session.execute(insert_query, {
                    "gym_id": gym_id,
                    "staff_id": staff_id,
                    "base_inicial": data.base_inicial
                })
                row = res_insert.mappings().one()
                turno_id = row["id"]
                abierto_en = row["abierto_en"]
        except IntegrityError:
            # Captura violación de constraint único ux_turno_abierto_por_staff ante concurrencia
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "TURNO_YA_ABIERTO", "mensaje": "Ya posee un turno de caja abierto actualmente"}
            )

        # 3. Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ABRIR_TURNO_CAJA",
            entidad="turnos_caja",
            entidad_id=str(turno_id),
            detalle={"base_inicial": float(data.base_inicial)}
        )

        return TurnoResumenDto(
            id=turno_id,
            gimnasio_id=gym_id,
            staff_id=staff_id,
            staff_nombre=staff_nombre,
            base_inicial=data.base_inicial,
            abierto_en=abierto_en,
            estado="abierto",
            total_esperado_efectivo=data.base_inicial
        )

    @classmethod
    async def obtener_turno_actual(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID
    ) -> TurnoResumenDto:
        query = text("""
            SELECT t.id, t.gimnasio_id, t.staff_id, s.nombre as staff_nombre, t.base_inicial,
                   t.abierto_en, t.cerrado_en, t.estado, t.cierre_forzado, t.efectivo_contado, t.diferencia
            FROM platform.turnos_caja t
            JOIN platform.staff s ON s.id = t.staff_id
            WHERE t.gimnasio_id = :gym_id AND t.staff_id = :staff_id AND t.estado = 'abierto'
        """)
        res = await session.execute(query, {"gym_id": gym_id, "staff_id": staff_id})
        turno = res.mappings().first()

        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "NO_HAY_TURNO_ABIERTO", "mensaje": "No tiene un turno de caja abierto actualmente"}
            )

        return await cls._calcular_acumulados_turno(session, turno)

    @classmethod
    async def cerrar_turno(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        actor_nombre: str,
        data: CerrarTurnoRequest
    ) -> TurnoResumenDto:
        # 1. Bloqueo pesimista del turno abierto
        query = text("""
            SELECT t.id, t.gimnasio_id, t.staff_id, s.nombre as staff_nombre, t.base_inicial,
                   t.abierto_en, t.cerrado_en, t.estado, t.cierre_forzado, t.efectivo_contado, t.diferencia
            FROM platform.turnos_caja t
            JOIN platform.staff s ON s.id = t.staff_id
            WHERE t.gimnasio_id = :gym_id AND t.staff_id = :staff_id AND t.estado = 'abierto'
            FOR UPDATE
        """)
        res = await session.execute(query, {"gym_id": gym_id, "staff_id": staff_id})
        turno = res.mappings().first()

        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "NO_HAY_TURNO_ABIERTO", "mensaje": "No tiene un turno de caja abierto para cerrar"}
            )

        # 2. Calcular acumulados y diferencia (permite cierre con descuadre, RF-10)
        resumen = await cls._calcular_acumulados_turno(session, turno)
        diferencia = data.efectivo_contado - resumen.total_esperado_efectivo

        # 3. Actualizar estado a cerrado
        now_dt = now_local()
        update_query = text("""
            UPDATE platform.turnos_caja
            SET estado = 'cerrado', cerrado_en = :now_dt,
                efectivo_contado = :contado, diferencia = :diff
            WHERE id = :turno_id
        """)
        await session.execute(update_query, {
            "turno_id": turno["id"],
            "now_dt": now_dt,
            "contado": data.efectivo_contado,
            "diff": diferencia
        })

        # 4. Auditoría
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=actor_nombre,
            accion="CERRAR_TURNO_CAJA",
            entidad="turnos_caja",
            entidad_id=str(turno["id"]),
            detalle={
                "total_esperado_efectivo": float(resumen.total_esperado_efectivo),
                "efectivo_contado": float(data.efectivo_contado),
                "diferencia": float(diferencia),
                "descuadre": diferencia != Decimal("0.0")
            }
        )

        resumen.estado = "cerrado"
        resumen.cerrado_en = now_dt
        resumen.efectivo_contado = data.efectivo_contado
        resumen.diferencia = diferencia
        return resumen

    @classmethod
    async def cerrar_turno_forzado(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        turno_id: UUID,
        actor_id: UUID,
        actor_nombre: str,
        motivo: str,
        efectivo_contado: Optional[Decimal] = None
    ) -> TurnoResumenDto:
        """
        Método reutilizable para forzar el cierre de turno.
        Puede ser invocado por el endpoint HTTP del Jefe o directamente por el Módulo 9 (Personal)
        al desactivar a un recepcionista con turno pendiente (RF-39).
        """
        # 1. Bloqueo pesimista del turno
        query = text("""
            SELECT t.id, t.gimnasio_id, t.staff_id, s.nombre as staff_nombre, t.base_inicial,
                   t.abierto_en, t.cerrado_en, t.estado, t.cierre_forzado, t.efectivo_contado, t.diferencia
            FROM platform.turnos_caja t
            JOIN platform.staff s ON s.id = t.staff_id
            WHERE t.id = :turno_id AND t.gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res = await session.execute(query, {"turno_id": turno_id, "gym_id": gym_id})
        turno = res.mappings().first()

        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "TURNO_NO_ENCONTRADO", "mensaje": "El turno de caja especificado no existe"}
            )
        if turno["estado"] != "abierto":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "TURNO_YA_CERRADO", "mensaje": "El turno ya se encuentra cerrado"}
            )

        # 2. Calcular acumulados y diferencia si se ingresó conteo
        resumen = await cls._calcular_acumulados_turno(session, turno)
        diferencia = (efectivo_contado - resumen.total_esperado_efectivo) if efectivo_contado is not None else None

        now_dt = now_local()
        update_query = text("""
            UPDATE platform.turnos_caja
            SET estado = 'cerrado', cerrado_en = :now_dt, cierre_forzado = true,
                efectivo_contado = :contado, diferencia = :diff
            WHERE id = :turno_id
        """)
        await session.execute(update_query, {
            "turno_id": turno_id,
            "now_dt": now_dt,
            "contado": efectivo_contado,
            "diff": diferencia
        })

        # 3. Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            accion="CIERRE_FORZADO_TURNO",
            entidad="turnos_caja",
            entidad_id=str(turno_id),
            detalle={
                "motivo": motivo,
                "staff_afectado_id": str(turno["staff_id"]),
                "staff_afectado_nombre": turno["staff_nombre"],
                "total_esperado_efectivo": float(resumen.total_esperado_efectivo),
                "efectivo_contado": float(efectivo_contado) if efectivo_contado is not None else None,
                "diferencia": float(diferencia) if diferencia is not None else None
            }
        )

        resumen.estado = "cerrado"
        resumen.cerrado_en = now_dt
        resumen.cierre_forzado = True
        resumen.efectivo_contado = efectivo_contado
        resumen.diferencia = diferencia
        return resumen

    # =========================================================================
    # 2. PUNTO DE VENTA ATÓMICO Y KARDEX (RF-11, RF-12)
    # =========================================================================

    @classmethod
    async def registrar_venta(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        idempotency_key: str,
        data: RegistrarVentaRequest
    ) -> VentaResponseDto:
        clean_key = idempotency_key.strip()

        # 1. Chequeo de Idempotencia previo (Camino HIT rápido)
        existente = await cls._consultar_venta_existente_por_idempotency_key(session, gym_id, clean_key)
        if existente:
            return existente

        # 2. Exigir turno de caja abierto para el staff logueado (RF-09)
        turno_query = text("""
            SELECT id FROM platform.turnos_caja
            WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
            FOR UPDATE
        """)
        res_turno = await session.execute(turno_query, {"gym_id": gym_id, "staff_id": staff_id})
        turno = res_turno.mappings().first()
        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "NO_HAY_TURNO_ABIERTO", "mensaje": "Debe abrir un turno de caja para registrar ventas"}
            )
        turno_id = turno["id"]

        # 3. Extracción y Bloqueo Pesimista Ordenado de Productos (Prevención de Deadlocks)
        items_producto = [it for it in data.items if it.tipo == "producto"]
        for it in items_producto:
            if not it.producto_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "PRODUCTO_ID_REQUERIDO", "mensaje": f"El ítem '{it.descripcion}' es tipo 'producto' pero no incluye producto_id"}
                )

        product_ids_sorted = sorted(list({it.producto_id for it in items_producto}))
        productos_map: Dict[UUID, dict] = {}

        if product_ids_sorted:
            prod_query = text("""
                SELECT id, nombre, precio, stock, activo
                FROM platform.productos
                WHERE gimnasio_id = :gym_id AND id = ANY(:ids)
                ORDER BY id
                FOR UPDATE
            """)
            res_prods = await session.execute(prod_query, {"gym_id": gym_id, "ids": product_ids_sorted})
            for row in res_prods.mappings():
                productos_map[row["id"]] = dict(row)

            # Verificar que todos los productos existan y estén activos
            for pid in product_ids_sorted:
                if pid not in productos_map:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail={"codigo": "PRODUCTO_NO_ENCONTRADO", "mensaje": f"Producto con ID {pid} no encontrado en el inventario"}
                    )
                if not productos_map[pid]["activo"]:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={"codigo": "PRODUCTO_INACTIVO", "mensaje": f"El producto '{productos_map[pid]['nombre']}' se encuentra desactivado"}
                    )

            # Verificar stock suficiente acumulado
            cantidades_acumuladas: Dict[UUID, int] = {}
            for it in items_producto:
                cantidades_acumuladas[it.producto_id] = cantidades_acumuladas.get(it.producto_id, 0) + it.cantidad

            for pid, qty_solicitada in cantidades_acumuladas.items():
                stock_actual = productos_map[pid]["stock"]
                if stock_actual < qty_solicitada:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "codigo": "STOCK_INSUFICIENTE",
                            "mensaje": f"Stock insuficiente para '{productos_map[pid]['nombre']}'. Disponible: {stock_actual}, solicitado: {qty_solicitada}"
                        }
                    )

        # 4. Cálculo de Precios Autoritativos y Subtotales
        items_procesados = []
        total_calculado = Decimal("0.0")

        for it in data.items:
            if it.tipo == "producto":
                # REGLA DE SEGURIDAD: Precio autoritativo tomado directo de platform.productos.precio
                precio_unitario = Decimal(str(productos_map[it.producto_id]["precio"]))
            else:
                # Pases de día y pases de clase toman el valor enviado
                if it.precio_unitario is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={"codigo": "PRECIO_UNITARIO_REQUERIDO", "mensaje": f"Debe proporcionar precio_unitario para '{it.descripcion}'"}
                    )
                precio_unitario = it.precio_unitario

            subtotal = precio_unitario * it.cantidad
            total_calculado += subtotal

            items_procesados.append({
                "tipo": it.tipo,
                "producto_id": it.producto_id,
                "descripcion": it.descripcion.strip(),
                "cantidad": it.cantidad,
                "precio_unitario": precio_unitario,
                "subtotal": subtotal
            })

        # 5. Validación de Pago en Efectivo y Cambio
        cambio_devuelto = None
        if data.tipo_medio == "efectivo" and data.valor_recibido is not None:
            if data.valor_recibido < total_calculado:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "PAGO_INSUFICIENTE", "mensaje": f"El valor recibido ({data.valor_recibido}) es menor al total a pagar ({total_calculado})"}
                )
            cambio_devuelto = data.valor_recibido - total_calculado

        # 6. Inserción con Savepoint para manejar condición de carrera en Idempotencia
        try:
            async with session.begin_nested():
                insert_v_query = text("""
                    INSERT INTO platform.ventas (
                        gimnasio_id, turno_id, deportista_id, total, metodo, tipo_medio,
                        valor_recibido, idempotency_key, registrada_por, created_at
                    ) VALUES (
                        :gym_id, :turno_id, :deportista_id, :total, :metodo, :tipo_medio,
                        :valor_recibido, :idempotency_key, :registrada_por, now()
                    ) RETURNING id, created_at
                """)
                res_v = await session.execute(insert_v_query, {
                    "gym_id": gym_id,
                    "turno_id": turno_id,
                    "deportista_id": data.deportista_id,
                    "total": total_calculado,
                    "metodo": data.metodo.strip(),
                    "tipo_medio": data.tipo_medio,
                    "valor_recibido": data.valor_recibido,
                    "idempotency_key": clean_key,
                    "registrada_por": staff_id
                })
                row_v = res_v.mappings().one()
                venta_id = row_v["id"]
                created_at = row_v["created_at"]
        except IntegrityError:
            # Carrera simultánea: otra transacción completó el INSERT con la misma llave
            existente_carrera = await cls._consultar_venta_existente_por_idempotency_key(session, gym_id, clean_key)
            if existente_carrera:
                return existente_carrera
            raise

        # 7. Inserción de ítems y Descuento de Stock en Kardex
        items_response = []
        for it in items_procesados:
            insert_item_query = text("""
                INSERT INTO platform.venta_items (
                    gimnasio_id, venta_id, tipo, producto_id, descripcion, cantidad, precio_unitario, subtotal
                ) VALUES (
                    :gym_id, :venta_id, :tipo, :producto_id, :descripcion, :cantidad, :precio_unitario, :subtotal
                ) RETURNING id
            """)
            res_it = await session.execute(insert_item_query, {
                "gym_id": gym_id,
                "venta_id": venta_id,
                "tipo": it["tipo"],
                "producto_id": it["producto_id"],
                "descripcion": it["descripcion"],
                "cantidad": it["cantidad"],
                "precio_unitario": it["precio_unitario"],
                "subtotal": it["subtotal"]
            })
            item_id = res_it.scalar_one()

            # Descontar stock y registrar movimiento en kardex SOLO para productos físicos
            if it["tipo"] == "producto":
                pid = it["producto_id"]
                await session.execute(text("""
                    UPDATE platform.productos 
                    SET stock = stock - :qty, updated_at = now()
                    WHERE id = :pid AND gimnasio_id = :gym_id
                """), {"qty": it["cantidad"], "pid": pid, "gym_id": gym_id})

                await session.execute(text("""
                    INSERT INTO platform.stock_movimientos (
                        gimnasio_id, producto_id, tipo, cantidad, motivo, registrado_por, created_at
                    ) VALUES (
                        :gym_id, :pid, 'venta', :neg_qty, :motivo, :staff_id, now()
                    )
                """), {
                    "gym_id": gym_id,
                    "pid": pid,
                    "neg_qty": -it["cantidad"],
                    "motivo": f"Venta POS {venta_id}",
                    "staff_id": staff_id
                })

            items_response.append(VentaItemResponseDto(
                id=item_id,
                tipo=it["tipo"],
                producto_id=it["producto_id"],
                descripcion=it["descripcion"],
                cantidad=it["cantidad"],
                precio_unitario=it["precio_unitario"],
                subtotal=it["subtotal"]
            ))

        return VentaResponseDto(
            id=venta_id,
            turno_id=turno_id,
            deportista_id=data.deportista_id,
            total=total_calculado,
            metodo=data.metodo.strip(),
            tipo_medio=data.tipo_medio,
            valor_recibido=data.valor_recibido,
            cambio_devuelto=cambio_devuelto,
            anulada=False,
            motivo_anulacion=None,
            idempotency_key=clean_key,
            items=items_response,
            created_at=created_at,
            idempotente_reintento=False
        )

    @classmethod
    async def anular_venta(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        venta_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        data: AnularVentaRequest
    ) -> None:
        # 1. Exigir turno abierto del cajero que efectúa la devolución (RF-12: el efectivo sale del turno actual)
        turno_query = text("""
            SELECT id FROM platform.turnos_caja
            WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
            FOR UPDATE
        """)
        res_turno = await session.execute(turno_query, {"gym_id": gym_id, "staff_id": staff_id})
        turno_actual = res_turno.mappings().first()
        if not turno_actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "NO_HAY_TURNO_ABIERTO", "mensaje": "Debe tener un turno de caja abierto para registrar la devolución de una venta"}
            )
        turno_devolucion_id = turno_actual["id"]

        # 2. Bloqueo de la venta
        v_query = text("""
            SELECT id, turno_id, total, anulada
            FROM platform.ventas
            WHERE id = :venta_id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_v = await session.execute(v_query, {"venta_id": venta_id, "gym_id": gym_id})
        venta = res_v.mappings().first()

        if not venta:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "VENTA_NO_ENCONTRADA", "mensaje": "Venta no encontrada"}
            )
        if venta["anulada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "VENTA_YA_ANULADA", "mensaje": "La venta ya se encuentra anulada"}
            )

        # 3. Obtener ítems de la venta
        items_query = text("""
            SELECT id, tipo, producto_id, cantidad, descripcion
            FROM platform.venta_items
            WHERE venta_id = :venta_id AND gimnasio_id = :gym_id
        """)
        res_items = await session.execute(items_query, {"venta_id": venta_id, "gym_id": gym_id})
        items = res_items.mappings().all()

        # 4. Reintegro de inventario SOLO para ítems con tipo == 'producto' (RF-12)
        items_prod = [it for it in items if it["tipo"] == "producto" and it["producto_id"] is not None]
        prod_ids_sorted = sorted(list({it["producto_id"] for it in items_prod}))

        if prod_ids_sorted:
            # Bloqueo pesimista ordenado de productos antes de reingresar stock
            await session.execute(text("""
                SELECT id FROM platform.productos
                WHERE gimnasio_id = :gym_id AND id = ANY(:ids)
                ORDER BY id
                FOR UPDATE
            """), {"gym_id": gym_id, "ids": prod_ids_sorted})

            for it in items_prod:
                pid = it["producto_id"]
                qty = it["cantidad"]
                await session.execute(text("""
                    UPDATE platform.productos 
                    SET stock = stock + :qty, updated_at = now()
                    WHERE id = :pid AND gimnasio_id = :gym_id
                """), {"qty": qty, "pid": pid, "gym_id": gym_id})

                await session.execute(text("""
                    INSERT INTO platform.stock_movimientos (
                        gimnasio_id, producto_id, tipo, cantidad, motivo, registrado_por, created_at
                    ) VALUES (
                        :gym_id, :pid, 'devolucion', :qty, :motivo, :staff_id, now()
                    )
                """), {
                    "gym_id": gym_id,
                    "pid": pid,
                    "qty": qty,
                    "motivo": f"Anulación Venta {venta_id}: {data.motivo.strip()}",
                    "staff_id": staff_id
                })

        # 5. Insertar registro contable en platform.devoluciones
        await session.execute(text("""
            INSERT INTO platform.devoluciones (
                gimnasio_id, venta_original_id, turno_venta_original_id, turno_devolucion_id,
                monto, tipo_medio_reembolso, motivo, registrada_por, created_at
            ) VALUES (
                :gym_id, :venta_id, :turno_orig_id, :turno_dev_id,
                :monto, :tipo_medio_reembolso, :motivo, :staff_id, now()
            )
        """), {
            "gym_id": gym_id,
            "venta_id": venta_id,
            "turno_orig_id": venta["turno_id"],
            "turno_dev_id": turno_devolucion_id,
            "monto": venta["total"],
            "tipo_medio_reembolso": data.tipo_medio_reembolso,
            "motivo": data.motivo.strip(),
            "staff_id": staff_id
        })

        # 6. Marcar venta como anulada
        now_dt = now_local()
        await session.execute(text("""
            UPDATE platform.ventas
            SET anulada = true, motivo_anulacion = :motivo,
                anulada_por = :staff_id, anulada_en = :now_dt
            WHERE id = :venta_id
        """), {
            "venta_id": venta_id,
            "motivo": data.motivo.strip(),
            "staff_id": staff_id,
            "now_dt": now_dt
        })

        # 7. Auditoría inmutable con hash-chain
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ANULAR_VENTA",
            entidad="ventas",
            entidad_id=str(venta_id),
            detalle={
                "total_reversado": float(venta["total"]),
                "turno_devolucion_id": str(turno_devolucion_id),
                "tipo_medio_reembolso": data.tipo_medio_reembolso,
                "motivo": data.motivo.strip(),
                "productos_reintegrados": len(items_prod)
            }
        )

    # =========================================================================
    # 3. PAGOS DE MEMBRESÍA LIGADOS AL TURNO (RF-15, RF-16, RF-25)
    # =========================================================================

    @classmethod
    async def registrar_pago_membresia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        idempotency_key: str,
        data: RegistrarPagoMembresiaRequest
    ) -> PagoMembresiaResponseDto:
        clean_key = idempotency_key.strip()

        # 1. Idempotencia HIT previa
        existente = await cls._consultar_pago_membresia_existente_por_key(session, gym_id, clean_key)
        if existente:
            return existente

        # 2. Exigir turno abierto
        turno_query = text("""
            SELECT id FROM platform.turnos_caja
            WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
            FOR UPDATE
        """)
        res_turno = await session.execute(turno_query, {"gym_id": gym_id, "staff_id": staff_id})
        turno = res_turno.mappings().first()
        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "NO_HAY_TURNO_ABIERTO", "mensaje": "Debe tener un turno de caja abierto para registrar pagos de membresía"}
            )
        turno_id = turno["id"]

        # 3. Bloqueo de la membresía para extensión de vigencia
        memb_query = text("""
            SELECT id, deportista_id, fecha_inicio, fecha_vencimiento, cancelada
            FROM platform.membresias
            WHERE id = :membresia_id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_memb = await session.execute(memb_query, {"membresia_id": data.membresia_id, "gym_id": gym_id})
        memb = res_memb.mappings().first()

        if not memb:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "MEMBRESIA_NO_ENCONTRADA", "mensaje": "La membresía especificada no existe"}
            )
        if memb["cancelada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "MEMBRESIA_CANCELADA", "mensaje": "No se pueden registrar pagos a una membresía cancelada"}
            )

        # 4. Cálculo de nueva fecha de vencimiento (RF-25: suma días, no se pierde lo pagado)
        hoy = today_local()
        venc_actual: date = memb["fecha_vencimiento"]
        if venc_actual < hoy:
            nueva_fecha_venc = hoy + timedelta(days=data.dias_agregados)
        else:
            nueva_fecha_venc = venc_actual + timedelta(days=data.dias_agregados)

        # 5. Cálculo de cambio
        cambio_devuelto = None
        if data.tipo_medio == "efectivo" and data.valor_recibido is not None:
            if data.valor_recibido < data.monto:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "PAGO_INSUFICIENTE", "mensaje": f"El valor recibido ({data.valor_recibido}) es menor al valor a pagar ({data.monto})"}
                )
            cambio_devuelto = data.valor_recibido - data.monto

        # 6. Inserción con Savepoint ante carreras simultáneas de idempotencia
        try:
            async with session.begin_nested():
                insert_pago = text("""
                    INSERT INTO platform.pagos_membresia (
                        gimnasio_id, turno_id, membresia_id, monto, metodo, tipo_medio,
                        dias_agregados, idempotency_key, registrado_por, created_at
                    ) VALUES (
                        :gym_id, :turno_id, :membresia_id, :monto, :metodo, :tipo_medio,
                        :dias_agregados, :idempotency_key, :registrado_por, now()
                    ) RETURNING id, created_at
                """)
                res_p = await session.execute(insert_pago, {
                    "gym_id": gym_id,
                    "turno_id": turno_id,
                    "membresia_id": data.membresia_id,
                    "monto": data.monto,
                    "metodo": data.metodo.strip(),
                    "tipo_medio": data.tipo_medio,
                    "dias_agregados": data.dias_agregados,
                    "idempotency_key": clean_key,
                    "registrado_por": staff_id
                })
                row_p = res_p.mappings().one()
                pago_id = row_p["id"]
                created_at = row_p["created_at"]
        except IntegrityError:
            existente_carrera = await cls._consultar_pago_membresia_existente_por_key(session, gym_id, clean_key)
            if existente_carrera:
                return existente_carrera
            raise

        # 7. Actualizar vencimiento en platform.membresias
        await session.execute(text("""
            UPDATE platform.membresias
            SET fecha_vencimiento = :nueva_fecha, updated_at = now()
            WHERE id = :membresia_id
        """), {"nueva_fecha": nueva_fecha_venc, "membresia_id": data.membresia_id})

        return PagoMembresiaResponseDto(
            id=pago_id,
            turno_id=turno_id,
            membresia_id=data.membresia_id,
            monto=data.monto,
            metodo=data.metodo.strip(),
            tipo_medio=data.tipo_medio,
            dias_agregados=data.dias_agregados,
            nueva_fecha_vencimiento=nueva_fecha_venc,
            valor_recibido=data.valor_recibido,
            cambio_devuelto=cambio_devuelto,
            anulado=False,
            motivo_anulacion=None,
            idempotency_key=clean_key,
            created_at=created_at,
            idempotente_reintento=False
        )

    @classmethod
    async def anular_pago_membresia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        pago_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        data: AnularPagoMembresiaRequest
    ) -> None:
        # 1. Bloqueo pesimista del pago
        pago_query = text("""
            SELECT id, turno_id, membresia_id, monto, dias_agregados, anulado
            FROM platform.pagos_membresia
            WHERE id = :pago_id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_p = await session.execute(pago_query, {"pago_id": pago_id, "gym_id": gym_id})
        pago = res_p.mappings().first()

        if not pago:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PAGO_NO_ENCONTRADO", "mensaje": "Pago de membresía no encontrado"}
            )
        if pago["anulado"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PAGO_YA_ANULADO", "mensaje": "El pago de membresía ya se encuentra anulado"}
            )

        # 2. Bloqueo de la membresía para revertir vigencia
        memb_query = text("""
            SELECT id, fecha_vencimiento FROM platform.membresias
            WHERE id = :membresia_id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_m = await session.execute(memb_query, {"membresia_id": pago["membresia_id"], "gym_id": gym_id})
        memb = res_m.mappings().first()

        if not memb:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "MEMBRESIA_NO_ENCONTRADA", "mensaje": "La membresía asociada al pago no existe"}
            )

        # 3. Reversión de la extensión de días (RF-16: el acceso histórico ya ocurrido permanece inmutable)
        fecha_venc_actual: date = memb["fecha_vencimiento"]
        fecha_venc_revertida = fecha_venc_actual - timedelta(days=pago["dias_agregados"])

        await session.execute(text("""
            UPDATE platform.membresias
            SET fecha_vencimiento = :revertida, updated_at = now()
            WHERE id = :membresia_id
        """), {"revertida": fecha_venc_revertida, "membresia_id": pago["membresia_id"]})

        # 4. Marcar pago como anulado
        now_dt = now_local()
        await session.execute(text("""
            UPDATE platform.pagos_membresia
            SET anulado = true, motivo_anulacion = :motivo,
                anulado_por = :staff_id, anulado_en = :now_dt
            WHERE id = :pago_id
        """), {
            "pago_id": pago_id,
            "motivo": data.motivo.strip(),
            "staff_id": staff_id,
            "now_dt": now_dt
        })

        # 5. Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ANULAR_PAGO_MEMBRESIA",
            entidad="pagos_membresia",
            entidad_id=str(pago_id),
            detalle={
                "membresia_id": str(pago["membresia_id"]),
                "monto_anulado": float(pago["monto"]),
                "dias_revertidos": pago["dias_agregados"],
                "fecha_vencimiento_anterior": str(fecha_venc_actual),
                "fecha_vencimiento_revertida": str(fecha_venc_revertida),
                "motivo": data.motivo.strip()
            }
        )

    # =========================================================================
    # 4. EGRESOS Y VALES DE CAJA (RF-14)
    # =========================================================================

    @classmethod
    async def registrar_egreso(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        data: RegistrarEgresoRequest
    ) -> EgresoResponseDto:
        # 1. Exigir turno abierto
        turno_query = text("""
            SELECT id FROM platform.turnos_caja
            WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
            FOR UPDATE
        """)
        res_turno = await session.execute(turno_query, {"gym_id": gym_id, "staff_id": staff_id})
        turno = res_turno.mappings().first()
        if not turno:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "NO_HAY_TURNO_ABIERTO", "mensaje": "Debe tener un turno de caja abierto para registrar egresos"}
            )
        turno_id = turno["id"]

        # 2. Insertar egreso (RF-14: puede dejar la caja en saldo negativo sin bloquear)
        insert_query = text("""
            INSERT INTO platform.egresos_caja (
                gimnasio_id, turno_id, motivo, monto, registrado_por, created_at
            ) VALUES (
                :gym_id, :turno_id, :motivo, :monto, :staff_id, now()
            ) RETURNING id, created_at
        """)
        res_eg = await session.execute(insert_query, {
            "gym_id": gym_id,
            "turno_id": turno_id,
            "motivo": data.motivo.strip(),
            "monto": data.monto,
            "staff_id": staff_id
        })
        row_eg = res_eg.mappings().one()

        # 3. Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="REGISTRAR_EGRESO_CAJA",
            entidad="egresos_caja",
            entidad_id=str(row_eg["id"]),
            detalle={"turno_id": str(turno_id), "monto": float(data.monto), "motivo": data.motivo.strip()}
        )

        return EgresoResponseDto(
            id=row_eg["id"],
            turno_id=turno_id,
            monto=data.monto,
            motivo=data.motivo.strip(),
            registrado_por_nombre=staff_nombre,
            created_at=row_eg["created_at"]
        )

    # =========================================================================
    # 5. HISTORIAL Y MOVIMIENTOS DEL TURNO (RF-13)
    # =========================================================================

    @classmethod
    async def obtener_movimientos_turno(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        turno_id: UUID
    ) -> HistorialMovimientosTurnoResponse:
        movimientos: List[MovimientoCajaItemDto] = []

        # 1. Ventas del turno
        v_res = await session.execute(text("""
            SELECT id, total, metodo, tipo_medio, anulada, created_at
            FROM platform.ventas
            WHERE turno_id = :turno_id AND gimnasio_id = :gym_id
        """), {"turno_id": turno_id, "gym_id": gym_id})
        for v in v_res.mappings():
            movimientos.append(MovimientoCajaItemDto(
                id=str(v["id"]),
                tipo_movimiento="venta",
                monto=v["total"],
                metodo=v["metodo"],
                tipo_medio=v["tipo_medio"],
                concepto=f"Venta POS ({v['metodo']})",
                anulado=v["anulada"],
                ts=v["created_at"]
            ))

        # 2. Pagos de membresía del turno
        p_res = await session.execute(text("""
            SELECT id, monto, metodo, tipo_medio, anulado, created_at
            FROM platform.pagos_membresia
            WHERE turno_id = :turno_id AND gimnasio_id = :gym_id
        """), {"turno_id": turno_id, "gym_id": gym_id})
        for p in p_res.mappings():
            movimientos.append(MovimientoCajaItemDto(
                id=str(p["id"]),
                tipo_movimiento="pago_membresia",
                monto=p["monto"],
                metodo=p["metodo"],
                tipo_medio=p["tipo_medio"],
                concepto=f"Pago Membresía ({p['metodo']})",
                anulado=p["anulado"],
                ts=p["created_at"]
            ))

        # 3. Egresos del turno
        e_res = await session.execute(text("""
            SELECT id, monto, motivo, created_at
            FROM platform.egresos_caja
            WHERE turno_id = :turno_id AND gimnasio_id = :gym_id
        """), {"turno_id": turno_id, "gym_id": gym_id})
        for e in e_res.mappings():
            movimientos.append(MovimientoCajaItemDto(
                id=str(e["id"]),
                tipo_movimiento="egreso",
                monto=e["monto"],
                metodo="efectivo",
                tipo_medio="efectivo",
                concepto=f"Egreso/Vale: {e['motivo']}",
                anulado=False,
                ts=e["created_at"]
            ))

        # 4. Devoluciones del turno
        d_res = await session.execute(text("""
            SELECT id, monto, tipo_medio_reembolso, motivo, created_at
            FROM platform.devoluciones
            WHERE turno_devolucion_id = :turno_id AND gimnasio_id = :gym_id
        """), {"turno_id": turno_id, "gym_id": gym_id})
        for d in d_res.mappings():
            tipo_reembolso = d.get("tipo_medio_reembolso", "efectivo")
            movimientos.append(MovimientoCajaItemDto(
                id=str(d["id"]),
                tipo_movimiento="devolucion",
                monto=d["monto"],
                metodo=tipo_reembolso,
                tipo_medio=tipo_reembolso,
                concepto=f"Reverso/Devolución ({tipo_reembolso}): {d['motivo']}",
                anulado=False,
                ts=d["created_at"]
            ))

        # Ordenar cronológicamente descendente
        movimientos.sort(key=lambda m: m.ts, reverse=True)

        return HistorialMovimientosTurnoResponse(
            turno_id=turno_id,
            total_movimientos=len(movimientos),
            items=movimientos
        )

    # =========================================================================
    # 6. HELPERS INTERNOS DE CÁLCULO E IDEMPOTENCIA
    # =========================================================================

    @staticmethod
    async def _calcular_acumulados_turno(session: AsyncSession, turno: dict) -> TurnoResumenDto:
        turno_id = turno["id"]

        # Ventas activas por tipo_medio
        v_query = text("""
            SELECT 
                COALESCE(SUM(total) FILTER (WHERE tipo_medio = 'efectivo'), 0) as v_efectivo,
                COALESCE(SUM(total) FILTER (WHERE tipo_medio = 'otro'), 0) as v_otro
            FROM platform.ventas
            WHERE turno_id = :turno_id AND anulada = false
        """)
        v_res = await session.execute(v_query, {"turno_id": turno_id})
        v_st = v_res.mappings().one()

        # Pagos membresía activos por tipo_medio
        p_query = text("""
            SELECT 
                COALESCE(SUM(monto) FILTER (WHERE tipo_medio = 'efectivo'), 0) as p_efectivo,
                COALESCE(SUM(monto) FILTER (WHERE tipo_medio = 'otro'), 0) as p_otro
            FROM platform.pagos_membresia
            WHERE turno_id = :turno_id AND anulado = false
        """)
        p_res = await session.execute(p_query, {"turno_id": turno_id})
        p_st = p_res.mappings().one()

        # Egresos en efectivo
        e_query = text("SELECT COALESCE(SUM(monto), 0) FROM platform.egresos_caja WHERE turno_id = :turno_id")
        e_res = await session.execute(e_query, {"turno_id": turno_id})
        egresos_total = Decimal(str(e_res.scalar() or 0))

        # Devoluciones en efectivo (únicamente las reembolsadas con tipo_medio_reembolso = 'efectivo')
        d_query = text("""
            SELECT COALESCE(SUM(monto) FILTER (WHERE tipo_medio_reembolso = 'efectivo'), 0)
            FROM platform.devoluciones
            WHERE turno_devolucion_id = :turno_id
        """)
        d_res = await session.execute(d_query, {"turno_id": turno_id})
        devoluciones_total = Decimal(str(d_res.scalar() or 0))

        base = Decimal(str(turno["base_inicial"]))
        v_efectivo = Decimal(str(v_st["v_efectivo"]))
        v_otro = Decimal(str(v_st["v_otro"]))
        p_efectivo = Decimal(str(p_st["p_efectivo"]))
        p_otro = Decimal(str(p_st["p_otro"]))

        total_esperado = base + v_efectivo + p_efectivo - egresos_total - devoluciones_total

        return TurnoResumenDto(
            id=turno["id"],
            gimnasio_id=turno["gimnasio_id"],
            staff_id=turno["staff_id"],
            staff_nombre=turno.get("staff_nombre"),
            base_inicial=base,
            abierto_en=turno["abierto_en"],
            cerrado_en=turno["cerrado_en"],
            estado=turno["estado"],
            ventas_efectivo=v_efectivo,
            ventas_otro=v_otro,
            pagos_membresia_efectivo=p_efectivo,
            pagos_membresia_otro=p_otro,
            egresos_efectivo=egresos_total,
            devoluciones_efectivo=devoluciones_total,
            total_esperado_efectivo=total_esperado,
            efectivo_contado=Decimal(str(turno["efectivo_contado"])) if turno.get("efectivo_contado") is not None else None,
            diferencia=Decimal(str(turno["diferencia"])) if turno.get("diferencia") is not None else None,
            cierre_forzado=bool(turno.get("cierre_forzado", False))
        )

    @classmethod
    async def _consultar_venta_existente_por_idempotency_key(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        idempotency_key: str
    ) -> Optional[VentaResponseDto]:
        v_query = text("""
            SELECT id, turno_id, deportista_id, total, metodo, tipo_medio,
                   valor_recibido, anulada, motivo_anulacion, idempotency_key, created_at
            FROM platform.ventas
            WHERE gimnasio_id = :gym_id AND idempotency_key = :key
        """)
        res_v = await session.execute(v_query, {"gym_id": gym_id, "key": idempotency_key})
        v = res_v.mappings().first()
        if not v:
            return None

        # Consultar ítems de la venta previa
        it_query = text("""
            SELECT id, tipo, producto_id, descripcion, cantidad, precio_unitario, subtotal
            FROM platform.venta_items
            WHERE venta_id = :venta_id AND gimnasio_id = :gym_id
        """)
        res_it = await session.execute(it_query, {"venta_id": v["id"], "gym_id": gym_id})
        items_dto = [
            VentaItemResponseDto(
                id=r["id"],
                tipo=r["tipo"],
                producto_id=r["producto_id"],
                descripcion=r["descripcion"],
                cantidad=r["cantidad"],
                precio_unitario=Decimal(str(r["precio_unitario"])),
                subtotal=Decimal(str(r["subtotal"]))
            ) for r in res_it.mappings()
        ]

        cambio = None
        if v["tipo_medio"] == "efectivo" and v["valor_recibido"] is not None:
            cambio = Decimal(str(v["valor_recibido"])) - Decimal(str(v["total"]))

        return VentaResponseDto(
            id=v["id"],
            turno_id=v["turno_id"],
            deportista_id=v["deportista_id"],
            total=Decimal(str(v["total"])),
            metodo=v["metodo"],
            tipo_medio=v["tipo_medio"],
            valor_recibido=Decimal(str(v["valor_recibido"])) if v["valor_recibido"] is not None else None,
            cambio_devuelto=cambio,
            anulada=v["anulada"],
            motivo_anulacion=v["motivo_anulacion"],
            idempotency_key=v["idempotency_key"],
            items=items_dto,
            created_at=v["created_at"],
            idempotente_reintento=True
        )

    @classmethod
    async def _consultar_pago_membresia_existente_por_key(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        idempotency_key: str
    ) -> Optional[PagoMembresiaResponseDto]:
        p_query = text("""
            SELECT p.id, p.turno_id, p.membresia_id, p.monto, p.metodo, p.tipo_medio,
                   p.dias_agregados, p.anulado, p.motivo_anulacion, p.idempotency_key, p.created_at,
                   m.fecha_vencimiento
            FROM platform.pagos_membresia p
            JOIN platform.membresias m ON m.id = p.membresia_id
            WHERE p.gimnasio_id = :gym_id AND p.idempotency_key = :key
        """)
        res_p = await session.execute(p_query, {"gym_id": gym_id, "key": idempotency_key})
        p = res_p.mappings().first()
        if not p:
            return None

        return PagoMembresiaResponseDto(
            id=p["id"],
            turno_id=p["turno_id"],
            membresia_id=p["membresia_id"],
            monto=Decimal(str(p["monto"])),
            metodo=p["metodo"],
            tipo_medio=p["tipo_medio"],
            dias_agregados=p["dias_agregados"],
            nueva_fecha_vencimiento=p["fecha_vencimiento"],
            valor_recibido=None,
            cambio_devuelto=None,
            anulado=p["anulado"],
            motivo_anulacion=p["motivo_anulacion"],
            idempotency_key=p["idempotency_key"],
            created_at=p["created_at"],
            idempotente_reintento=True
        )
