from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import (
    AuthenticatedStaff,
    get_current_staff,
    get_db_session,
    require_permission,
)
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
from app.modules.inventario.service import InventarioService

router = APIRouter(prefix="/inventario", tags=["08. Inventario y Stock"])


@router.get(
    "/status",
    summary="Estado del módulo inventario",
    description="Retorna el estado de disponibilidad del módulo de Inventario y Stock."
)
async def get_status():
    return {"modulo": "inventario", "estado": "operativo"}


# =====================================================================
# ENDPOINTS DE CATÁLOGO DE PRODUCTOS (RF-36)
# =====================================================================

@router.post(
    "/productos",
    response_model=ProductoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear producto en catálogo (RF-36)",
    description="Registra un nuevo producto comercial en el catálogo del gimnasio. Si se define stock_inicial mayor a cero, genera automáticamente el asiento correspondiente en el Kardex."
)
async def crear_producto(
    data: CrearProductoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await InventarioService.crear_producto(
        session=session,
        gym_id=current_staff.gimnasio_id,
        data=data,
        staff_id=current_staff.id,
    )


@router.get(
    "/productos",
    response_model=PaginatedProductosResponse,
    summary="Listar catálogo de productos (RF-36)",
    description="Consulta los productos del gimnasio con soporte de paginación, búsqueda textual por nombre y filtros por estado o alertas de stock crítico."
)
async def listar_productos(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    buscar: Optional[str] = Query(None, description="Término de búsqueda insensible a mayúsculas"),
    activo: Optional[bool] = Query(None, description="Filtrar por estado activo o inactivo"),
    bajo_stock: Optional[bool] = Query(None, description="Filtrar productos con stock crítico (menor o igual a 5)"),
    limit: int = Query(50, ge=1, le=100, description="Límite de registros por página"),
    offset: int = Query(0, ge=0, description="Desplazamiento para paginación"),
):
    return await InventarioService.listar_productos(
        session=session,
        gym_id=current_staff.gimnasio_id,
        buscar=buscar,
        activo=activo,
        bajo_stock=bajo_stock,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/productos/{id}",
    response_model=ProductoResponse,
    summary="Obtener detalle de producto (RF-36)",
    description="Consulta la información maestra y el stock disponible actual de un producto específico."
)
async def obtener_producto(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await InventarioService.obtener_producto(
        session=session,
        gym_id=current_staff.gimnasio_id,
        producto_id=id,
    )


@router.put(
    "/productos/{id}",
    response_model=ProductoResponse,
    summary="Actualizar producto (RF-36)",
    description="Modifica los datos comerciales (nombre y precio) de un producto. El stock físico no puede ser modificado mediante este endpoint para garantizar la integridad contable del Kardex."
)
async def actualizar_producto(
    id: UUID,
    data: ActualizarProductoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await InventarioService.actualizar_producto(
        session=session,
        gym_id=current_staff.gimnasio_id,
        producto_id=id,
        data=data,
    )


@router.patch(
    "/productos/{id}/estado",
    response_model=ProductoResponse,
    summary="Activar o desactivar producto (RF-36)",
    description="Modifica la disponibilidad operativa de un producto. Los productos desactivados no se eliminan físicamente pero quedan inhabilitados para ventas en Caja."
)
async def cambiar_estado_producto(
    id: UUID,
    data: CambiarEstadoProductoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await InventarioService.cambiar_estado(
        session=session,
        gym_id=current_staff.gimnasio_id,
        producto_id=id,
        data=data,
    )


# =====================================================================
# ENDPOINTS DE MOVIMIENTOS DE STOCK Y KARDEX (RF-37)
# =====================================================================

@router.post(
    "/productos/{id}/entrada",
    response_model=StockMovimientoResponse,
    summary="Registrar entrada de stock (RF-37)",
    description="Ingresa unidades al inventario por abastecimiento de proveedores. Bloquea pesimistamente el producto y asienta el movimiento en el Kardex."
)
async def registrar_entrada_stock(
    id: UUID,
    data: EntradaStockRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await InventarioService.registrar_entrada_stock(
        session=session,
        gym_id=current_staff.gimnasio_id,
        producto_id=id,
        data=data,
        staff_id=current_staff.id,
        actor_nombre=current_staff.nombre,
    )


@router.post(
    "/productos/{id}/ajuste",
    response_model=StockMovimientoResponse,
    summary="Registrar ajuste manual de stock con auditoría (RF-37)",
    description="Aplica un ajuste de inventario (positivo o negativo) derivado de conteos físicos, mermas o pérdidas. Exige justificación obligatoria y registra el evento en la cadena de auditoría inmutable del gimnasio."
)
async def registrar_ajuste_stock(
    id: UUID,
    data: AjusteStockRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await InventarioService.registrar_ajuste_stock(
        session=session,
        gym_id=current_staff.gimnasio_id,
        producto_id=id,
        data=data,
        staff_id=current_staff.id,
        actor_nombre=current_staff.nombre,
    )


@router.get(
    "/productos/{id}/kardex",
    response_model=PaginatedStockMovimientosResponse,
    summary="Consultar Kardex individual de producto (RF-37)",
    description="Obtiene la cronología detallada de todos los movimientos de stock (entradas, ventas, devoluciones y ajustes) de un producto determinado."
)
async def listar_kardex_producto(
    id: UUID,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    limit: int = Query(50, ge=1, le=100, description="Cantidad de movimientos a retornar"),
    offset: int = Query(0, ge=0, description="Desplazamiento para paginación"),
):
    return await InventarioService.listar_kardex_producto(
        session=session,
        gym_id=current_staff.gimnasio_id,
        producto_id=id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/kardex",
    response_model=PaginatedStockMovimientosResponse,
    summary="Consultar Kardex general del gimnasio (RF-37)",
    description="Obtiene el flujo global de movimientos de bodega del gimnasio, con opción de filtro por tipo de movimiento (entrada, ajuste, venta, devolucion)."
)
async def listar_kardex_general(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("inventario", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    tipo: Optional[str] = Query(None, description="Filtrar por tipo: entrada, ajuste, venta, devolucion"),
    limit: int = Query(50, ge=1, le=100, description="Cantidad de movimientos a retornar"),
    offset: int = Query(0, ge=0, description="Desplazamiento para paginación"),
):
    return await InventarioService.listar_kardex_general(
        session=session,
        gym_id=current_staff.gimnasio_id,
        tipo=tipo,
        limit=limit,
        offset=offset,
    )

