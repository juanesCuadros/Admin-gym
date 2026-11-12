"""Activación de una estación y primer ingreso del personal desde ella."""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.contexto_gimnasio import fijar_gimnasio_por_subdominio
from app.core.database import async_session_maker
from app.core.dependencies import gimnasio_suspendido_exception, verificar_suscripcion_operativa
from app.core.security import generate_secure_token, hash_token, verify_password
from app.modules.auth.service import AuthService
from app.modules.sync.dependencias import EstacionAutenticada
from app.modules.sync.estaciones import normalizar_codigo
from app.modules.sync.schemas import (
    ActivarEstacionRequest,
    EstacionActivadaDto,
    GimnasioEstacionDto,
    SesionStaffRequest,
    SesionStaffResponse,
    StaffEstacionDto,
)

MAX_INTENTOS_ACTIVACION = 5
MAX_INTENTOS_CUENTA = 5


def _codigo_invalido() -> HTTPException:
    # Un solo mensaje para subdominio inexistente, código errado, usado o vencido: no revela cuál falló.
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={
            "codigo": "CODIGO_INVALIDO",
            "mensaje": "El subdominio o el código no son válidos, o el código ya venció. Pídele uno nuevo al Jefe del gimnasio.",
        },
    )


async def _registrar_intento(gym_id: UUID, ip: Optional[str], exito: bool) -> None:
    """En una transacción aparte: el intento fallido debe quedar aunque la petición termine en error."""
    async with async_session_maker() as s:
        async with s.begin():
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym_id)})
            await s.execute(
                text("INSERT INTO platform.sync_intentos_activacion (gimnasio_id, ip, exito) VALUES (:g, :ip, :ok)"),
                {"g": gym_id, "ip": ip, "ok": exito},
            )


class ActivacionService:
    @staticmethod
    async def activar(session: AsyncSession, data: ActivarEstacionRequest, ip: Optional[str]) -> EstacionActivadaDto:
        gym_id = await fijar_gimnasio_por_subdominio(session, data.subdominio)
        if gym_id is None:
            raise _codigo_invalido()

        res = await session.execute(
            text("SELECT id, nombre, subdominio, activo FROM platform.tenant WHERE id = :id"), {"id": gym_id}
        )
        tenant = res.mappings().one()
        if not tenant["activo"]:
            raise gimnasio_suspendido_exception("suspendido")
        await verificar_suscripcion_operativa(session, gym_id)

        res = await session.execute(
            text("""
                SELECT count(*) FROM platform.sync_intentos_activacion
                WHERE gimnasio_id = :g AND exito = false AND created_at >= now() - interval '15 minutes'
            """),
            {"g": gym_id},
        )
        if (res.scalar() or 0) >= MAX_INTENTOS_ACTIVACION:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "codigo": "ACTIVACION_BLOQUEADA",
                    "mensaje": "Demasiados intentos fallidos de activación. Espera 15 minutos e intenta de nuevo.",
                    "detalles": {"minutos": 15},
                },
            )

        res = await session.execute(
            text("""
                SELECT id, nombre FROM platform.estaciones
                WHERE gimnasio_id = :g AND codigo_hash = :h
                  AND revocada_en IS NULL AND activada_en IS NULL AND codigo_expira_en > now()
                FOR UPDATE
            """),
            {"g": gym_id, "h": hash_token(normalizar_codigo(data.codigo))},
        )
        estacion = res.mappings().first()
        if not estacion:
            await _registrar_intento(gym_id, ip, False)
            raise _codigo_invalido()

        token = generate_secure_token(32)
        await session.execute(
            text("""
                UPDATE platform.estaciones
                SET device_token_hash = :t, activada_en = now(), codigo_hash = NULL, codigo_expira_en = NULL,
                    nombre_equipo = :equipo, version_app = :version
                WHERE id = :id AND gimnasio_id = :g
            """),
            {"t": hash_token(token), "equipo": data.nombre_equipo, "version": data.version_app, "id": estacion["id"], "g": gym_id},
        )
        await session.execute(
            text("INSERT INTO platform.sync_intentos_activacion (gimnasio_id, ip, exito) VALUES (:g, :ip, true)"),
            {"g": gym_id, "ip": ip},
        )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=None, actor_nombre=f"Estación {estacion['nombre']}",
            accion="ACTIVAR_ESTACION", entidad="estaciones", entidad_id=estacion["id"],
            detalle={"nombre": estacion["nombre"], "nombre_equipo": data.nombre_equipo, "version_app": data.version_app},
        )
        return EstacionActivadaDto(
            estacion_id=estacion["id"],
            nombre=estacion["nombre"],
            device_token=token,
            gimnasio=GimnasioEstacionDto(id=gym_id, nombre=tenant["nombre"], subdominio=tenant["subdominio"]),
        )

    @staticmethod
    async def sesion_staff(
        session: AsyncSession, estacion: EstacionAutenticada, data: SesionStaffRequest, ip: Optional[str]
    ) -> SesionStaffResponse:
        """
        Primer ingreso de una persona en la estación: el servidor valida la contraseña con las mismas
        reglas del login web. La estación guarda después su propio verificador; aquí no sale ningún hash.
        """
        gym_id = estacion.gimnasio_id
        correo = data.correo.strip().lower()

        res = await session.execute(
            text("""
                SELECT count(*) FROM platform.intentos_login_staff
                WHERE gimnasio_id = :g AND correo = :c AND exito = false AND created_at >= now() - interval '15 minutes'
            """),
            {"g": gym_id, "c": correo},
        )
        if (res.scalar() or 0) >= MAX_INTENTOS_CUENTA:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "codigo": "CUENTA_BLOQUEADA_TEMPORALMENTE",
                    "mensaje": "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.",
                    "detalles": {"minutos": 15},
                },
            )

        res = await session.execute(
            text("""
                SELECT id, nombre, correo, hash_password, rol, activo, debe_cambiar_password,
                       password_temporal_expira_en, password_cambiada_en
                FROM platform.staff
                WHERE gimnasio_id = :g AND correo = :c AND deleted_at IS NULL
            """),
            {"g": gym_id, "c": correo},
        )
        staff = res.mappings().first()
        # Persona inexistente, desactivada o con contraseña errada: la misma respuesta.
        if not staff or not staff["activo"] or not verify_password(data.password, staff["hash_password"]):
            await AuthService._registrar_intento_fallido(gym_id, correo, ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"codigo": "CREDENCIALES_INVALIDAS", "mensaje": "Correo o contraseña incorrectos."},
            )

        debe_cambiar, _ = await AuthService._estado_password_temporal(
            session, gym_id, staff["rol"], staff["debe_cambiar_password"], staff["password_temporal_expira_en"]
        )
        if debe_cambiar:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "DEBE_CAMBIAR_PASSWORD",
                    "mensaje": "Tu contraseña es temporal. Entra primero al sistema web, cámbiala y vuelve a ingresar aquí.",
                },
            )

        await session.execute(
            text("INSERT INTO platform.intentos_login_staff (gimnasio_id, correo, ip, exito) VALUES (:g, :c, :ip, true)"),
            {"g": gym_id, "c": correo, "ip": ip},
        )
        await AuditService.registrar(
            session=session, gimnasio_id=gym_id, actor_id=staff["id"], actor_nombre=staff["nombre"],
            accion="INICIAR_SESION_ESTACION", entidad="estaciones", entidad_id=estacion.id,
            detalle={"estacion": estacion.nombre},
        )
        permisos = await AuthService.obtener_lista_permisos_usuario(session, gym_id, staff["rol"])
        return SesionStaffResponse(
            staff=StaffEstacionDto(
                id=staff["id"], nombre=staff["nombre"], correo=staff["correo"], rol=staff["rol"],
                password_cambiada_en=staff["password_cambiada_en"],
            ),
            permisos=permisos,
            servidor_ahora=datetime.now(timezone.utc),
        )
