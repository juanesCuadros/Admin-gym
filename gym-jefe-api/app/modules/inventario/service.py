"""
Lógica de negocio para el módulo 08: Inventario y Stock (RF-36 a RF-38).
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional, Dict, Any, List
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.modules.inventario.schemas import (
    CrearProductoRequest,
    ActualizarProductoRequest,
    CambiarEstadoProductoRequest,
    EntradaStockRequest,
    AjusteStockRequest,
    ProductoResponse,
    StockMovimientoResponse,
    PaginatedProductosResponse,
    PaginatedStockMovimientosResponse,
)


class InventarioService:

    # =====================================================================
    # MÉTODO INTERNO ATÓMICO: APLICACIÓN DE MOVIMIENTO DE STOCK
    # =====================================================================
    @classmethod
    async def _aplicar_movimiento_stock(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
        tipo: str,
        cantidad: int,
        motivo: Optional[str],
        staff_id: Optional[UUID],
    ) -> Dict[str, Any]:
        """
        Bloquea pesimistamente el producto, valida stock no negativo y registra
        el movimiento en platform.stock_movimientos.

        NOTA DE DISEÑO (Arquitectura de Concurrencia y Bloqueos):
        _aplicar_movimiento_stock en Inventario opera de forma atómica sobre un único producto (single-item).
        A diferencia del flujo multi-ítem de Caja (POST /caja/ventas), que bloquea múltiples productos
        simultáneamente y por tanto exige ordenamiento estricto (ORDER BY id) para prevenir interbloqueos (deadlocks),
        esta operación atómica individual no corre riesgo de deadlock circular.
        Si en futuras versiones de GymOS se incorpora una operación de ajuste o recepción masiva multi-producto
        en una sola transacción, DEBERÁ aplicarse obligatoriamente el ordenamiento ascendente por ID
        (WHERE id = ANY(:ids) ORDER BY id FOR UPDATE) tal como ya está implementado en Caja.
        """
        # 1. Bloqueo pesimista del producto
        select_query = text("""
            SELECT id, nombre, stock, version, activo
            FROM platform.productos
            WHERE id = :pid AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res = await session.execute(select_query, {"pid": producto_id, "gym_id": gym_id})
        prod = res.mappings().first()

        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PRODUCTO_NO_ENCONTRADO", "mensaje": "El producto especificado no existe en este gimnasio"}
            )

        stock_anterior = prod["stock"]
        nuevo_stock = stock_anterior + cantidad

        # 2. Validación de regla de negocio: no vender ni ajustar por debajo de cero
        if nuevo_stock < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "codigo": "STOCK_INSUFICIENTE",
                    "mensaje": f"Stock insuficiente para '{prod['nombre']}'. Disponible: {stock_anterior}, reducción solicitada: {abs(cantidad)}"
                }
            )

        # 3. Actualización de stock en platform.productos
        update_query = text("""
            UPDATE platform.productos
            SET stock = :nuevo_stock, version = version + 1, updated_at = now()
            WHERE id = :pid AND gimnasio_id = :gym_id
        """)
        await session.execute(update_query, {
            "nuevo_stock": nuevo_stock,
            "pid": producto_id,
            "gym_id": gym_id
        })

        # 4. Inserción en kardex (platform.stock_movimientos)
        insert_mov_query = text("""
            INSERT INTO platform.stock_movimientos (
                gimnasio_id, producto_id, tipo, cantidad, motivo, registrado_por, created_at
            ) VALUES (
                :gym_id, :pid, :tipo, :cantidad, :motivo, :staff_id, now()
            ) RETURNING id, created_at
        """)
        res_mov = await session.execute(insert_mov_query, {
            "gym_id": gym_id,
            "pid": producto_id,
            "tipo": tipo,
            "cantidad": cantidad,
            "motivo": motivo,
            "staff_id": staff_id
        })
        mov_row = res_mov.mappings().one()

        return {
            "movimiento_id": mov_row["id"],
            "created_at": mov_row["created_at"],
            "producto_id": producto_id,
            "producto_nombre": prod["nombre"],
            "stock_anterior": stock_anterior,
            "nuevo_stock": nuevo_stock,
            "tipo": tipo,
            "cantidad": cantidad,
            "motivo": motivo,
            "registrado_por": staff_id
        }

    # =====================================================================
    # ADMINISTRACIÓN DE CATÁLOGO (RF-36)
    # =====================================================================
    @classmethod
    async def crear_producto(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        data: CrearProductoRequest,
        staff_id: UUID,
    ) -> ProductoResponse:
        """Crea un nuevo producto en el catálogo del gimnasio con stock inicial opcional."""
        nombre_limpio = data.nombre.strip()

        # 1. Validar nombre único en este gimnasio
        check_query = text("""
            SELECT id FROM platform.productos
            WHERE gimnasio_id = :gym_id AND lower(nombre) = lower(:nombre)
        """)
        res_check = await session.execute(check_query, {"gym_id": gym_id, "nombre": nombre_limpio})
        if res_check.first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "PRODUCTO_YA_EXISTE", "mensaje": f"Ya existe un producto con el nombre '{nombre_limpio}' en este gimnasio"}
            )

        # 2. Insertar producto
        insert_query = text("""
            INSERT INTO platform.productos (
                gimnasio_id, nombre, precio, stock, activo, version, created_at, updated_at
            ) VALUES (
                :gym_id, :nombre, :precio, :stock, :activo, 1, now(), now()
            ) RETURNING id, gimnasio_id, nombre, precio, stock, activo, version, created_at, updated_at
        """)
        res_ins = await session.execute(insert_query, {
            "gym_id": gym_id,
            "nombre": nombre_limpio,
            "precio": data.precio,
            "stock": data.stock_inicial,
            "activo": data.activo
        })
        row = res_ins.mappings().one()
        producto_id = row["id"]

        # 3. Registrar movimiento inicial en kardex si stock_inicial > 0
        if data.stock_inicial > 0:
            await session.execute(text("""
                INSERT INTO platform.stock_movimientos (
                    gimnasio_id, producto_id, tipo, cantidad, motivo, registrado_por, created_at
                ) VALUES (
                    :gym_id, :pid, 'entrada', :cantidad, 'Inventario inicial', :staff_id, now()
                )
            """), {
                "gym_id": gym_id,
                "pid": producto_id,
                "cantidad": data.stock_inicial,
                "staff_id": staff_id
            })

        return ProductoResponse(**dict(row))

    @classmethod
    async def listar_productos(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        buscar: Optional[str] = None,
        activo: Optional[bool] = None,
        bajo_stock: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PaginatedProductosResponse:
        """Lista los productos del gimnasio con soporte para filtros de búsqueda, estado y stock bajo."""
        filtros = ["gimnasio_id = :gym_id"]
        params: Dict[str, Any] = {"gym_id": gym_id, "limit": limit, "offset": offset}

        if buscar and buscar.strip():
            filtros.append("nombre ILIKE :buscar")
            params["buscar"] = f"%{buscar.strip()}%"

        if activo is not None:
            filtros.append("activo = :activo")
            params["activo"] = activo

        if bajo_stock:
            filtros.append("stock <= 5")

        where_clause = " AND ".join(filtros)

        count_query = text(f"SELECT COUNT(*) FROM platform.productos WHERE {where_clause}")
        total = (await session.execute(count_query, params)).scalar() or 0

        data_query = text(f"""
            SELECT id, gimnasio_id, nombre, precio, stock, activo, version, created_at, updated_at
            FROM platform.productos
            WHERE {where_clause}
            ORDER BY nombre ASC
            LIMIT :limit OFFSET :offset
        """)
        res = await session.execute(data_query, params)
        items = [ProductoResponse(**dict(r)) for r in res.mappings().all()]

        return PaginatedProductosResponse(
            items=items,
            total=total,
            limit=limit,
            offset=offset
        )

    @classmethod
    async def obtener_producto(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
    ) -> ProductoResponse:
        """Obtiene el detalle completo de un producto por su ID asegurando aislamiento tenant."""
        query = text("""
            SELECT id, gimnasio_id, nombre, precio, stock, activo, version, created_at, updated_at
            FROM platform.productos
            WHERE id = :pid AND gimnasio_id = :gym_id
        """)
        res = await session.execute(query, {"pid": producto_id, "gym_id": gym_id})
        prod = res.mappings().first()

        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PRODUCTO_NO_ENCONTRADO", "mensaje": "El producto especificado no existe en este gimnasio"}
            )

        return ProductoResponse(**dict(prod))

    @classmethod
    async def actualizar_producto(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
        data: ActualizarProductoRequest,
    ) -> ProductoResponse:
        """
        Actualiza el nombre y precio maestro del producto.
        El stock permanece inmutable para obligar al uso del Kardex (RF-36).
        """
        nombre_limpio = data.nombre.strip()

        # 1. Bloqueo pesimista y verificación de existencia
        check_query = text("""
            SELECT id, nombre, stock, precio, activo, version
            FROM platform.productos
            WHERE id = :pid AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res = await session.execute(check_query, {"pid": producto_id, "gym_id": gym_id})
        prod = res.mappings().first()
        if not prod:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PRODUCTO_NO_ENCONTRADO", "mensaje": "El producto especificado no existe en este gimnasio"}
            )

        # 2. Si cambia el nombre, validar unicidad
        if prod["nombre"].lower() != nombre_limpio.lower():
            dup_query = text("""
                SELECT id FROM platform.productos
                WHERE gimnasio_id = :gym_id AND lower(nombre) = lower(:nombre) AND id <> :pid
            """)
            res_dup = await session.execute(dup_query, {
                "gym_id": gym_id,
                "nombre": nombre_limpio,
                "pid": producto_id
            })
            if res_dup.first():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"codigo": "PRODUCTO_YA_EXISTE", "mensaje": f"Ya existe otro producto con el nombre '{nombre_limpio}'"}
                )

        # 3. Actualizar registro
        update_query = text("""
            UPDATE platform.productos
            SET nombre = :nombre, precio = :precio, version = version + 1, updated_at = now()
            WHERE id = :pid AND gimnasio_id = :gym_id
            RETURNING id, gimnasio_id, nombre, precio, stock, activo, version, created_at, updated_at
        """)
        res_up = await session.execute(update_query, {
            "nombre": nombre_limpio,
            "precio": data.precio,
            "pid": producto_id,
            "gym_id": gym_id
        })
        return ProductoResponse(**dict(res_up.mappings().one()))

    @classmethod
    async def cambiar_estado(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
        data: CambiarEstadoProductoRequest,
    ) -> ProductoResponse:
        """Activa o desactiva lógicamente un producto sin alterar sus datos contables."""
        update_query = text("""
            UPDATE platform.productos
            SET activo = :activo, version = version + 1, updated_at = now()
            WHERE id = :pid AND gimnasio_id = :gym_id
            RETURNING id, gimnasio_id, nombre, precio, stock, activo, version, created_at, updated_at
        """)
        res = await session.execute(update_query, {
            "activo": data.activo,
            "pid": producto_id,
            "gym_id": gym_id
        })
        row = res.mappings().first()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PRODUCTO_NO_ENCONTRADO", "mensaje": "El producto especificado no existe en este gimnasio"}
            )
        return ProductoResponse(**dict(row))

    # =====================================================================
    # OPERACIONES DE STOCK Y KARDEX (RF-37)
    # =====================================================================
    @classmethod
    async def registrar_entrada_stock(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
        data: EntradaStockRequest,
        staff_id: UUID,
        actor_nombre: str,
    ) -> StockMovimientoResponse:
        """
        Registra la recepción de mercancía aumentando el stock y asentando en Kardex.
        """
        motivo = data.motivo.strip() if data.motivo else "Recepción de mercancía"
        mov = await cls._aplicar_movimiento_stock(
            session=session,
            gym_id=gym_id,
            producto_id=producto_id,
            tipo="entrada",
            cantidad=data.cantidad,
            motivo=motivo,
            staff_id=staff_id,
        )

        return StockMovimientoResponse(
            id=mov["movimiento_id"],
            producto_id=producto_id,
            producto_nombre=mov["producto_nombre"],
            tipo="entrada",
            cantidad=mov["cantidad"],
            motivo=motivo,
            registrado_por=staff_id,
            registrado_por_nombre=actor_nombre,
            created_at=mov["created_at"],
        )

    @classmethod
    async def registrar_ajuste_stock(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
        data: AjusteStockRequest,
        staff_id: UUID,
        actor_nombre: str,
    ) -> StockMovimientoResponse:
        """
        Registra un ajuste de stock (incremento o merma/rotura/pérdida).
        Exige justificación de al menos 10 caracteres y registra auditoría estricta (RF-37).
        """
        motivo_limpio = data.motivo.strip()
        mov = await cls._aplicar_movimiento_stock(
            session=session,
            gym_id=gym_id,
            producto_id=producto_id,
            tipo="ajuste",
            cantidad=data.cantidad,
            motivo=motivo_limpio,
            staff_id=staff_id,
        )

        # Registro obligatorio en auditoría hash-chain (RF-37)
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=actor_nombre,
            accion="AJUSTE_STOCK_INVENTARIO",
            entidad="productos",
            entidad_id=str(producto_id),
            detalle={
                "producto_id": str(producto_id),
                "producto_nombre": mov["producto_nombre"],
                "stock_anterior": mov["stock_anterior"],
                "cantidad_ajustada": data.cantidad,
                "nuevo_stock": mov["nuevo_stock"],
                "motivo": motivo_limpio,
            }
        )

        return StockMovimientoResponse(
            id=mov["movimiento_id"],
            producto_id=producto_id,
            producto_nombre=mov["producto_nombre"],
            tipo="ajuste",
            cantidad=mov["cantidad"],
            motivo=motivo_limpio,
            registrado_por=staff_id,
            registrado_por_nombre=actor_nombre,
            created_at=mov["created_at"],
        )

    @classmethod
    async def listar_kardex_producto(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        producto_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> PaginatedStockMovimientosResponse:
        """Retorna el historial completo de movimientos de un producto."""
        # Verificar pertenencia del producto al tenant
        await cls.obtener_producto(session, gym_id, producto_id)

        count_query = text("""
            SELECT COUNT(*) FROM platform.stock_movimientos
            WHERE gimnasio_id = :gym_id AND producto_id = :pid
        """)
        total = (await session.execute(count_query, {"gym_id": gym_id, "pid": producto_id})).scalar() or 0

        data_query = text("""
            SELECT sm.id, sm.producto_id, p.nombre as producto_nombre,
                   sm.tipo, sm.cantidad, sm.motivo, sm.registrado_por,
                   s.nombre as registrado_por_nombre, sm.created_at
            FROM platform.stock_movimientos sm
            JOIN platform.productos p ON sm.producto_id = p.id
            LEFT JOIN platform.staff s ON sm.registrado_por = s.id
            WHERE sm.gimnasio_id = :gym_id AND sm.producto_id = :pid
            ORDER BY sm.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        res = await session.execute(data_query, {
            "gym_id": gym_id,
            "pid": producto_id,
            "limit": limit,
            "offset": offset
        })
        items = [StockMovimientoResponse(**dict(r)) for r in res.mappings().all()]

        return PaginatedStockMovimientosResponse(
            items=items,
            total=total,
            limit=limit,
            offset=offset
        )

    @classmethod
    async def listar_kardex_general(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        tipo: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PaginatedStockMovimientosResponse:
        """Retorna el flujo de movimientos de stock global del gimnasio."""
        filtros = ["sm.gimnasio_id = :gym_id"]
        params: Dict[str, Any] = {"gym_id": gym_id, "limit": limit, "offset": offset}

        if tipo and tipo.strip():
            filtros.append("sm.tipo = :tipo")
            params["tipo"] = tipo.strip().lower()

        where_clause = " AND ".join(filtros)

        count_query = text(f"""
            SELECT COUNT(*)
            FROM platform.stock_movimientos sm
            WHERE {where_clause}
        """)
        total = (await session.execute(count_query, params)).scalar() or 0

        data_query = text(f"""
            SELECT sm.id, sm.producto_id, p.nombre as producto_nombre,
                   sm.tipo, sm.cantidad, sm.motivo, sm.registrado_por,
                   s.nombre as registrado_por_nombre, sm.created_at
            FROM platform.stock_movimientos sm
            JOIN platform.productos p ON sm.producto_id = p.id
            LEFT JOIN platform.staff s ON sm.registrado_por = s.id
            WHERE {where_clause}
            ORDER BY sm.created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        res = await session.execute(data_query, params)
        items = [StockMovimientoResponse(**dict(r)) for r in res.mappings().all()]

        return PaginatedStockMovimientosResponse(
            items=items,
            total=total,
            limit=limit,
            offset=offset
        )

