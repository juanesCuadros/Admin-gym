import hmac
import json
import logging
from datetime import datetime
from typing import List, Optional
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

from app.core.audit import AuditService
from app.core.database import on_commit
from app.core.security import generate_secure_token, hash_token
from app.core.timezone import get_local_day_range_utc, now_local, today_local
from app.modules.pantalla_tv.manager import PantallaTvConnectionManager
from app.modules.pantalla_tv.schemas import (
    ActualizarPantallaConfigRequest,
    AvisoPantallaItem,
    ClaseItemTvDto,
    DisplayDataResponse,
    PantallaConfigDto,
    RegenerarDeviceTokenResponse,
    TestSaludoRequest,
)

logger = logging.getLogger(__name__)


class PantallaTvService:
    """Lógica de negocio y persistencia para la Pantalla de Recepción (TV)."""

    @staticmethod
    async def validar_device_token(session: AsyncSession, subdominio: str, token: str) -> Optional[dict]:
        """
        Valida que el subdominio exista, esté activo y que el device_token coincida
        con pantalla_device_token_hash en platform.tenant mediante comparación en tiempo constante (Ley 1581).
        """
        token_hash = hash_token(token.strip())
        query = text("""
            SELECT id, nombre, subdominio, activo, pantalla_device_token_hash, pantalla_config
            FROM platform.tenant
            WHERE subdominio = :subdominio
        """)
        res = await session.execute(query, {"subdominio": subdominio.lower().strip()})
        tenant = res.mappings().first()

        if not tenant or not tenant["activo"]:
            return None

        # Si no se ha configurado token o el hash no coincide, se rechaza la conexión
        stored_hash = tenant["pantalla_device_token_hash"]
        if not stored_hash or not hmac.compare_digest(stored_hash, token_hash):
            return None

        return dict(tenant)

    @classmethod
    async def obtener_display_data(cls, session: AsyncSession, subdominio: str) -> DisplayDataResponse:
        """
        Consulta pública del estado inicial para la carga del DOM en el televisor.
        PATRÓN RLS:
        1. Resuelve tenant por subdominio.
        2. Ejecuta SET LOCAL app.gimnasio_id = :gym_id.
        3. Realiza las consultas de clases y configuración bajo contexto de tenant.
        """
        # 1. Resolver tenant
        t_res = await session.execute(text("""
            SELECT id, nombre, subdominio, activo, pantalla_config
            FROM platform.tenant
            WHERE subdominio = :subdominio
        """), {"subdominio": subdominio.lower().strip()})
        tenant = t_res.mappings().first()

        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "GIMNASIO_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado"}
            )
        if not tenant["activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "GIMNASIO_SUSPENDIDO", "mensaje": "El servicio del gimnasio se encuentra suspendido"}
            )

        gym_id = tenant["id"]

        # 2. Establecer RLS explícito antes de consultar datos protegidos
        await session.execute(
            text("SET LOCAL app.gimnasio_id = :gym_id"),
            {"gym_id": str(gym_id)}
        )

        # 3. Parsear configuración de pantalla
        config_raw = tenant["pantalla_config"] or {}
        if isinstance(config_raw, str):
            config_raw = json.loads(config_raw)

        config_dto = PantallaConfigDto(
            logo_url=config_raw.get("logo_url"),
            tiempo_saludo_segundos=config_raw.get("tiempo_saludo_segundos", 8),
            mostrar_clases=config_raw.get("mostrar_clases", True),
            mostrar_avisos=config_raw.get("mostrar_avisos", True),
            avisos=[AvisoPantallaItem(**a) for a in config_raw.get("avisos", [])]
        )

        # 4. Consultar clases del día actual en America/Bogota
        clases_hoy: List[ClaseItemTvDto] = []
        if config_dto.mostrar_clases:
            hoy = today_local()
            inicio_utc, fin_utc = get_local_day_range_utc(hoy)

            clases_query = text("""
                SELECT 
                    c.id, c.nombre, c.fecha_hora, c.cupo, c.profesor_externo,
                    s.nombre as entrenador_nombre,
                    (SELECT COUNT(*) FROM platform.reservas_clase rc 
                     WHERE rc.clase_id = c.id AND rc.estado IN ('reservada', 'asistio')) as cupos_ocupados
                FROM platform.clases c
                LEFT JOIN platform.staff s ON s.id = c.entrenador_id
                WHERE c.gimnasio_id = :gym_id
                  AND c.fecha_hora BETWEEN :inicio_utc AND :fin_utc
                  AND c.estado != 'cancelada'
                ORDER BY c.fecha_hora ASC
            """)
            res_clases = await session.execute(clases_query, {
                "gym_id": gym_id,
                "inicio_utc": inicio_utc,
                "fin_utc": fin_utc
            })

            bogota_tz = ZoneInfo("America/Bogota")
            for r in res_clases.mappings():
                dt_local = r["fecha_hora"].astimezone(bogota_tz)
                instructor = r["profesor_externo"] or r["entrenador_nombre"] or "Instructor Asignado"
                disponibles = max(0, r["cupo"] - (r["cupos_ocupados"] or 0))

                clases_hoy.append(ClaseItemTvDto(
                    id=r["id"],
                    nombre=r["nombre"],
                    hora=dt_local.strftime("%I:%M %p"),
                    entrenador_nombre=instructor,
                    cupos_disponibles=disponibles
                ))

        return DisplayDataResponse(
            gimnasio_id=gym_id,
            gimnasio_nombre=tenant["nombre"],
            subdominio=tenant["subdominio"],
            hora_local=now_local(),
            configuracion=config_dto,
            clases_hoy=clases_hoy
        )

    @staticmethod
    async def obtener_config(session: AsyncSession, gym_id: UUID) -> PantallaConfigDto:
        """Obtiene la configuración actual de la pantalla para el panel administrativo del gimnasio."""
        query = text("SELECT pantalla_config FROM platform.tenant WHERE id = :gym_id")
        res = await session.execute(query, {"gym_id": gym_id})
        config_raw = res.scalar() or {}
        if isinstance(config_raw, str):
            config_raw = json.loads(config_raw)

        return PantallaConfigDto(
            logo_url=config_raw.get("logo_url"),
            tiempo_saludo_segundos=config_raw.get("tiempo_saludo_segundos", 8),
            mostrar_clases=config_raw.get("mostrar_clases", True),
            mostrar_avisos=config_raw.get("mostrar_avisos", True),
            avisos=[AvisoPantallaItem(**a) for a in config_raw.get("avisos", [])]
        )

    @classmethod
    async def actualizar_config(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        actor_id: UUID,
        actor_nombre: str,
        data: ActualizarPantallaConfigRequest
    ) -> PantallaConfigDto:
        """
        Actualiza los parámetros y avisos de la pantalla TV.
        Audita el cambio con hash-chain SHA-256 y difunde en vivo a los WebSockets conectados
        únicamente tras confirmarse el commit en base de datos.
        """
        # 1. Obtener configuración existente
        actual_dto = await cls.obtener_config(session, gym_id)
        config_dict = actual_dto.model_dump()

        # 2. Aplicar actualizaciones parciales
        if data.logo_url is not None:
            config_dict["logo_url"] = data.logo_url.strip() if data.logo_url else None
        if data.tiempo_saludo_segundos is not None:
            config_dict["tiempo_saludo_segundos"] = data.tiempo_saludo_segundos
        if data.mostrar_clases is not None:
            config_dict["mostrar_clases"] = data.mostrar_clases
        if data.mostrar_avisos is not None:
            config_dict["mostrar_avisos"] = data.mostrar_avisos
        if data.avisos is not None:
            config_dict["avisos"] = [a.model_dump() for a in data.avisos]

        # 3. Guardar en base de datos
        await session.execute(text("""
            UPDATE platform.tenant 
            SET pantalla_config = :cfg::jsonb, updated_at = now()
            WHERE id = :gym_id
        """), {
            "cfg": json.dumps(config_dict),
            "gym_id": gym_id
        })

        # 4. Registrar auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            accion="ACTUALIZAR_CONFIG_PANTALLA_TV",
            entidad="tenant",
            entidad_id=str(gym_id),
            detalle={"config": config_dict}
        )

        nueva_config_dto = PantallaConfigDto(**config_dict)

        # 5. Difundir cambio a pantallas activas ÚNICAMENTE tras confirmarse el commit
        payload_broadcast = {
            "tipo": "CONFIG_ACTUALIZADA",
            "configuracion": nueva_config_dto.model_dump(),
            "ts_local": now_local().isoformat()
        }
        on_commit(session, lambda: PantallaTvConnectionManager.broadcast_to_gym(gym_id, payload_broadcast))

        return nueva_config_dto

    @staticmethod
    async def regenerar_device_token(
        session: AsyncSession,
        gym_id: UUID,
        actor_id: UUID,
        actor_nombre: str
    ) -> RegenerarDeviceTokenResponse:
        """
        Genera un nuevo token de dispositivo seguro (32 bytes) para autenticar la pantalla física (TV).
        Guarda el hash SHA-256 en platform.tenant y devuelve el token en texto plano una sola vez.
        """
        raw_token = generate_secure_token(32)
        t_hash = hash_token(raw_token)

        await session.execute(text("""
            UPDATE platform.tenant 
            SET pantalla_device_token_hash = :hash, updated_at = now()
            WHERE id = :gym_id
        """), {
            "hash": t_hash,
            "gym_id": gym_id
        })

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            accion="REGENERAR_DEVICE_TOKEN_PANTALLA",
            entidad="tenant",
            entidad_id=str(gym_id),
            detalle={"metodo": "admin_panel"}
        )

        return RegenerarDeviceTokenResponse(
            device_token=raw_token,
            mensaje="Token de dispositivo generado con éxito. Configure este token en la URL o cliente del televisor (?device_token=...). Por seguridad, no podrá consultarse nuevamente."
        )

    @staticmethod
    async def simular_saludo(gym_id: UUID, data: TestSaludoRequest) -> dict:
        """Emite un evento de prueba hacia las pantallas activas del gimnasio."""
        payload = {
            "tipo": "CHECKIN_EVENTO",
            "checkin_id": 999999,
            "metodo": "manual",
            "resultado": "abrio",
            "comando_torniquete": True,
            "mensaje": data.mensaje or f"Prueba de bienvenida para {data.nombre}",
            "deportista": {
                "nombre": data.nombre,
                "documento": "TEST-123456",
                "estado_calculado": data.estado,
                "dias_restantes_o_vencido": data.dias_restantes
            },
            "ts_local": now_local().isoformat()
        }
        await PantallaTvConnectionManager.broadcast_to_gym(gym_id, payload)
        return {"resultado": "evento_emitido", "destinatario_gym_id": str(gym_id)}
