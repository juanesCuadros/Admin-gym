import asyncio
import json
import logging
from typing import Dict, Set
from uuid import UUID
from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

from app.modules.control_ingreso.schemas import CheckinResponseDto

logger = logging.getLogger(__name__)


class PantallaTvConnectionManager:
    """
    Gestor en memoria de conexiones WebSocket para displays públicos (Pantallas TV de recepción).
    Mantiene aislamiento estricto por gimnasio (tenant isolation) y distribuye eventos en tiempo real.
    
    NOTA ARQUITECTURAL: PantallaTvConnectionManager en memoria asume una sola instancia del backend;
    si se escala horizontalmente en el futuro, habrá que migrar a un pub/sub compartido (Redis u otro).
    """

    # Piscinas de conexiones activas indexadas por gimnasio_id
    _active_connections: Dict[UUID, Set[WebSocket]] = {}

    @classmethod
    async def connect(cls, gym_id: UUID, websocket: WebSocket) -> None:
        """Acepta y registra una nueva conexión WebSocket para el gimnasio indicado."""
        await websocket.accept()
        if gym_id not in cls._active_connections:
            cls._active_connections[gym_id] = set()
        cls._active_connections[gym_id].add(websocket)
        logger.info(f"[Pantalla TV] Conexión establecida para gimnasio {gym_id}. Total activas: {len(cls._active_connections[gym_id])}")

    @classmethod
    def disconnect(cls, gym_id: UUID, websocket: WebSocket) -> None:
        """Remueve de forma segura un socket desconectado de la piscina del gimnasio."""
        if gym_id in cls._active_connections:
            cls._active_connections[gym_id].discard(websocket)
            if not cls._active_connections[gym_id]:
                del cls._active_connections[gym_id]
        logger.info(f"[Pantalla TV] Conexión cerrada para gimnasio {gym_id}.")

    @classmethod
    async def broadcast_to_gym(cls, gym_id: UUID, payload: dict) -> None:
        """
        Emite un mensaje a todas las pantallas activas del gimnasio indicado.
        Limpia automáticamente cualquier socket roto o desconectado.
        """
        sockets = list(cls._active_connections.get(gym_id, []))
        if not sockets:
            return

        message_str = json.dumps(jsonable_encoder(payload))
        sockets_to_remove = []

        for ws in sockets:
            try:
                await ws.send_text(message_str)
            except Exception as e:
                logger.warning(f"[Pantalla TV] Error enviando mensaje a socket en gimnasio {gym_id}: {e}")
                sockets_to_remove.append(ws)

        for dead_ws in sockets_to_remove:
            cls.disconnect(gym_id, dead_ws)

    @classmethod
    async def on_checkin_event(cls, gym_id: UUID, checkin: CheckinResponseDto) -> None:
        """
        Callback suscriptor de ControlIngresoService.
        Se ejecuta automáticamente vía hook 'on_commit' tras confirmarse el registro en base de datos.
        """
        dep_data = None
        if checkin.deportista:
            dep_data = {
                "id": str(checkin.deportista.id),
                "nombre": checkin.deportista.nombre,
                "documento": checkin.deportista.documento,
                "estado_calculado": checkin.deportista.estado_calculado,
                "dias_restantes_o_vencido": checkin.deportista.dias_restantes_o_vencido,
            }
        elif checkin.tipo == "cortesia":
            dep_data = {
                "nombre": "Invitado/a Especial",
                "estado_calculado": "cortesia",
                "dias_restantes_o_vencido": 0,
            }

        payload = {
            "tipo": "CHECKIN_EVENTO",
            "checkin_id": checkin.checkin_id,
            "metodo": checkin.metodo,
            "resultado": checkin.resultado,
            "comando_torniquete": checkin.comando_torniquete,
            "mensaje": checkin.mensaje,
            "deportista": dep_data,
            "ts_local": checkin.ts_local.isoformat()
        }

        await cls.broadcast_to_gym(gym_id, payload)
