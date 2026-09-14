from typing import Annotated, Dict
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import (
    AuthenticatedStaff,
    get_db_session,
    require_permission,
    require_role,
)
from app.modules.caja.schemas import (
    AbrirTurnoRequest,
    AnularPagoMembresiaRequest,
    AnularVentaRequest,
    CerrarTurnoRequest,
    CierreForzadoRequest,
    EgresoResponseDto,
    HistorialMovimientosTurnoResponse,
    PagoMembresiaResponseDto,
    RegistrarEgresoRequest,
    RegistrarPagoMembresiaRequest,
    RegistrarVentaRequest,
    TurnoResumenDto,
    VentaResponseDto,
)
from app.modules.caja.service import CajaService

router = APIRouter(prefix="/caja", tags=["03. Caja y Turnos"])


# =============================================================================
# 1. GESTIÓN DE TURNOS DE CAJA (RF-08, RF-09, RF-10)
# =============================================================================

@router.post(
    "/turnos/abrir",
    response_model=TurnoResumenDto,
    status_code=status.HTTP_201_CREATED,
    summary="Abrir turno de caja para el recepcionista logueado (RF-08)"
)
async def abrir_turno(
    data: AbrirTurnoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Inicia un nuevo turno de caja fijando la base inicial en efectivo.
    Restringe a un único turno abierto simultáneo por staff.
    """
    return await CajaService.abrir_turno(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        data=data
    )


@router.get(
    "/turnos/actual",
    response_model=TurnoResumenDto,
    summary="Consultar resumen y arqueo en vivo del turno actual (RF-09, RF-10)"
)
async def obtener_turno_actual(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Devuelve las cifras acumuladas en tiempo real para el turno abierto del staff:
    base inicial, ventas (efectivo/otro), renovaciones de membresía, egresos y devoluciones.
    """
    return await CajaService.obtener_turno_actual(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id
    )


@router.post(
    "/turnos/cerrar",
    response_model=TurnoResumenDto,
    summary="Cierre ordinario de turno con arqueo de efectivo físico (RF-10)"
)
async def cerrar_turno(
    data: CerrarTurnoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Cierra el turno abierto del cajero calculando el total esperado y la diferencia
    frente al efectivo contado real. Permite cierre con descuadre auditado.
    """
    return await CajaService.cerrar_turno(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        actor_nombre=current_staff.nombre,
        data=data
    )


@router.post(
    "/turnos/{turno_id}/cierre-forzado",
    response_model=TurnoResumenDto,
    summary="Cierre forzado de turno por el Jefe / Administrador (RF-10, RF-39)"
)
async def cerrar_turno_forzado(
    turno_id: Annotated[UUID, Path(description="UUID del turno a forzar cierre")],
    data: CierreForzadoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Permite al Jefe forzar el cierre de un turno de cualquier recepcionista con justificación
    obligatoria. Reutiliza el método del servicio que también invoca el Módulo de Personal.
    """
    return await CajaService.cerrar_turno_forzado(
        session=session,
        gym_id=current_staff.gimnasio_id,
        turno_id=turno_id,
        actor_id=current_staff.id,
        actor_nombre=current_staff.nombre,
        motivo=data.motivo,
        efectivo_contado=data.efectivo_contado
    )


@router.get(
    "/turnos/{turno_id}/movimientos",
    response_model=HistorialMovimientosTurnoResponse,
    summary="Historial cronológico de movimientos del turno (RF-13)"
)
async def obtener_movimientos_turno(
    turno_id: Annotated[UUID, Path(description="UUID del turno a consultar")],
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "leer"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Retorna la lista consolidada de transacciones del turno (ventas, membresías, egresos, devoluciones)
    ordenadas cronológicamente en orden descendente.
    """
    return await CajaService.obtener_movimientos_turno(
        session=session,
        gym_id=current_staff.gimnasio_id,
        turno_id=turno_id
    )


# =============================================================================
# 2. PUNTO DE VENTA (POS) Y KARDEX (RF-11, RF-12)
# =============================================================================

@router.post(
    "/ventas",
    response_model=VentaResponseDto,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar venta POS multi-ítem con bloqueo pesimista e idempotencia (RF-11)"
)
async def registrar_venta(
    data: RegistrarVentaRequest,
    x_idempotency_key: Annotated[
        str,
        Header(
            alias="X-Idempotency-Key",
            description="UUID o string único por operación para prevenir cobros duplicados",
            min_length=8,
            max_length=128
        )
    ],
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Registra una venta POS atómica:
    - Exige turno de caja abierto para el cajero.
    - Bloqueo pesimista ordenado de productos (`FOR UPDATE`) para prevenir deadlocks.
    - Toma el precio autoritativo directo de `platform.productos.precio` (ignora el precio unitario del request).
    - Descuenta stock inmediatamente y registra movimiento en `stock_movimientos`.
    - Idempotencia segura con savepoint (`session.begin_nested()`) para evitar errores 500 ante colisiones simultáneas.
    """
    return await CajaService.registrar_venta(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        idempotency_key=x_idempotency_key,
        data=data
    )


@router.post(
    "/ventas/{venta_id}/anular",
    response_model=Dict[str, str],
    summary="Anular venta, reingresar stock y registrar egreso en turno actual (RF-12)"
)
async def anular_venta(
    venta_id: Annotated[UUID, Path(description="UUID de la venta a anular")],
    data: AnularVentaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "eliminar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Anula una venta previa:
    - Exige turno de caja abierto del recepcionista (el dinero de la devolución sale del turno actual).
    - Reingresa stock al inventario y genera movimiento en kardex SOLO para ítems tipo 'producto'.
    - Registra el movimiento contable en `platform.devoluciones`.
    - Genera registro inmutable en auditoría con hash-chain.
    """
    await CajaService.anular_venta(
        session=session,
        gym_id=current_staff.gimnasio_id,
        venta_id=venta_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        data=data
    )
    return {"mensaje": "Venta anulada y devolución registrada exitosamente", "venta_id": str(venta_id)}


# =============================================================================
# 3. PAGOS Y RENOVACIÓN DE MEMBRESÍA EN CAJA (RF-15, RF-16, RF-25)
# =============================================================================

@router.post(
    "/pagos-membresia",
    response_model=PagoMembresiaResponseDto,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar pago y renovación de membresía ligado al turno (RF-15, RF-25)"
)
async def registrar_pago_membresia(
    data: RegistrarPagoMembresiaRequest,
    x_idempotency_key: Annotated[
        str,
        Header(
            alias="X-Idempotency-Key",
            description="UUID o string único por operación para prevenir cobros duplicados",
            min_length=8,
            max_length=128
        )
    ],
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Registra el cobro de una membresía:
    - Liga el ingreso financiero al turno de caja abierto.
    - Extiende la fecha de vencimiento sumando los días adquiridos sin perder días restantes si no ha vencido.
    - Soporta idempotencia transaccional con manejo de condiciones de carrera.
    """
    return await CajaService.registrar_pago_membresia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        idempotency_key=x_idempotency_key,
        data=data
    )


@router.post(
    "/pagos-membresia/{pago_id}/anular",
    response_model=Dict[str, str],
    summary="Anular pago de membresía y revertir vigencia sin alterar accesos históricos (RF-16)"
)
async def anular_pago_membresia(
    pago_id: Annotated[UUID, Path(description="UUID del pago a anular")],
    data: AnularPagoMembresiaRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "eliminar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Anula un pago de membresía:
    - Resta los días previamente agregados a la membresía.
    - Mantiene inalterados e inmutables los registros históricos de check-ins previos.
    - Marca el pago como anulado con justificación obligatoria y auditoría.
    """
    await CajaService.anular_pago_membresia(
        session=session,
        gym_id=current_staff.gimnasio_id,
        pago_id=pago_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        data=data
    )
    return {"mensaje": "Pago de membresía anulado y vigencia revertida", "pago_id": str(pago_id)}


# =============================================================================
# 4. EGRESOS Y VALES DE CAJA (RF-14)
# =============================================================================

@router.post(
    "/egresos",
    response_model=EgresoResponseDto,
    status_code=status.HTTP_201_CREATED,
    summary="Registrar egreso o vale de caja menor (RF-14)"
)
async def registrar_egreso(
    data: RegistrarEgresoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("caja", "crear"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Registra un retiro de efectivo de la caja menor (compra de insumos, vale, etc.):
    - Vinculado al turno de caja abierto.
    - Exige justificación/motivo obligatorio.
    - Puede dejar el balance de caja en saldo negativo sin bloquear la operación (RF-14).
    """
    return await CajaService.registrar_egreso(
        session=session,
        gym_id=current_staff.gimnasio_id,
        staff_id=current_staff.id,
        staff_nombre=current_staff.nombre,
        data=data
    )
