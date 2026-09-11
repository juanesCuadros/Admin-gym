import logging
from typing import Annotated
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_maker, get_db_session
from app.core.dependencies import (
    AuthenticatedStaff,
    get_current_staff,
    require_permission,
    require_role,
)
from app.modules.pantalla_tv.manager import PantallaTvConnectionManager
from app.modules.pantalla_tv.schemas import (
    ActualizarPantallaConfigRequest,
    DisplayDataResponse,
    PantallaConfigDto,
    RegenerarDeviceTokenResponse,
    TestSaludoRequest,
)
from app.modules.pantalla_tv.service import PantallaTvService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pantalla-tv", tags=["02. Pantalla TV"])


@router.websocket("/ws/{subdominio}")
async def websocket_pantalla_tv(
    websocket: WebSocket,
    subdominio: str,
    device_token: str = Query(..., description="Token de dispositivo seguro para autorizar la pantalla (Ley 1581)")
):
    """
    Canal WebSocket en tiempo real para displays públicos de recepción (TV):
    - Requiere 'device_token' obligatorio validado contra 'pantalla_device_token_hash' en platform.tenant.
    - Transmite eventos de check-in en tiempo real únicamente del gimnasio autenticado.
    - Soporta heartbeat bidireccional ('ping' -> 'pong') y auto-recuperación ante caídas de red (RNF-06).
    """
    # 1. Validar credenciales de dispositivo antes de aceptar el handshake
    async with async_session_maker() as session:
        tenant = await PantallaTvService.validar_device_token(session, subdominio, device_token)

    if not tenant:
        logger.warning(f"[Pantalla TV WS] Intento de conexión rechazado para subdominio '{subdominio}' - Token de dispositivo inválido o no configurado.")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Dispositivo no autorizado o token inválido")
        return

    gym_id = tenant["id"]

    # 2. Registrar conexión en el gestor de WebSockets
    await PantallaTvConnectionManager.connect(gym_id, websocket)

    # 3. Notificar handshake exitoso
    await websocket.send_json({
        "tipo": "CONECTADO",
        "gimnasio": tenant["nombre"],
        "subdominio": tenant["subdominio"],
        "mensaje": "Pantalla TV conectada y sincronizada en tiempo real"
    })

    # 4. Mantener canal vivo y procesar pings de liveness
    try:
        while True:
            data = await websocket.receive_text()
            if data.strip().lower() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        PantallaTvConnectionManager.disconnect(gym_id, websocket)
    except Exception as e:
        logger.warning(f"[Pantalla TV WS] Error en socket ({subdominio}): {e}")
        PantallaTvConnectionManager.disconnect(gym_id, websocket)


@router.get(
    "/display/{subdominio}",
    response_model=DisplayDataResponse,
    summary="Obtener estado consolidado inicial del display público (RF-07)"
)
async def obtener_display_data(
    subdominio: str,
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Consulta REST pública para la carga inicial del televisor:
    - Resuelve el gimnasio por subdominio y ejecuta SET LOCAL app.gimnasio_id para cumplir RLS.
    - Retorna logo, hora local de Bogotá, avisos activos y clases programadas para el día actual.
    """
    return await PantallaTvService.obtener_display_data(session, subdominio)


@router.get(
    "/config",
    response_model=PantallaConfigDto,
    summary="Consultar configuración del display de recepción (Staff)"
)
async def obtener_config(
    current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Consulta los parámetros de configuración de la pantalla TV (logo, duración del saludo y avisos).
    """
    return await PantallaTvService.obtener_config(session, current_staff.gimnasio_id)


@router.put(
    "/config",
    response_model=PantallaConfigDto,
    summary="Actualizar configuración y avisos de la pantalla TV (Jefe / Recepción con permiso)"
)
async def actualizar_config(
    data: ActualizarPantallaConfigRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "editar"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Modifica la configuración del display:
    - Guarda en platform.tenant (jsonb).
    - Genera registro de auditoría con hash-chain en platform.auditoria_gym.
    - Notifica inmediatamente vía WebSocket ('CONFIG_ACTUALIZADA') a las pantallas activas tras el commit.
    """
    return await PantallaTvService.actualizar_config(
        session=session,
        gym_id=current_staff.gimnasio_id,
        actor_id=current_staff.id,
        actor_nombre=current_staff.nombre,
        data=data
    )


@router.post(
    "/regenerar-token",
    response_model=RegenerarDeviceTokenResponse,
    summary="Regenerar token de autenticación del dispositivo TV (Solo Jefe)"
)
async def regenerar_device_token(
    current_staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    session: Annotated[AsyncSession, Depends(get_db_session)]
):
    """
    Genera una nueva credencial de dispositivo para conectar el televisor físico.
    Invalida el token anterior inmediatamente y audita la acción.
    """
    return await PantallaTvService.regenerar_device_token(
        session=session,
        gym_id=current_staff.gimnasio_id,
        actor_id=current_staff.id,
        actor_nombre=current_staff.nombre
    )


@router.post(
    "/test-saludo",
    summary="Emitir saludo de prueba a las pantallas TV conectadas"
)
async def test_saludo(
    data: TestSaludoRequest,
    current_staff: Annotated[AuthenticatedStaff, Depends(require_permission("configuracion", "editar"))]
):
    """
    Permite al personal probar la visualización y audio del display simulando un evento de bienvenida en vivo.
    """
    return await PantallaTvService.simular_saludo(current_staff.gimnasio_id, data)
