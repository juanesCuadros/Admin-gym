import hmac
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

import jwt
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.config import settings
from app.core.contexto_gimnasio import (
    fijar_gimnasio,
    fijar_gimnasio_por_correo_deportista,
    fijar_gimnasio_por_subdominio,
)
from app.core.database import async_session_maker, on_commit
from app.core.dependencies import (
    AuthenticatedDeportista,
    gimnasio_suspendido_exception,
    verificar_suscripcion_operativa,
)
from app.core.email import correo_pin_portal_deportista, email_adaptador
from app.core.security import decode_access_token, hash_password, hash_token, verify_password
from app.modules.deportistas.service import DeportistasService
from app.modules.portal_deportista.schemas import (
    ActualizarPerfilDeportistaRequest,
    AsistenciaPortalItem,
    AsistenciasPortalResponse,
    CompraItemPortalDto,
    CompraTiendaPortalItem,
    DeportistaAuthPerfilDto,
    EstablecerPasswordDeportistaRequest,
    FinanzasDeportistaResponse,
    IniciarAccesoDeportistaRequest,
    IniciarAccesoDeportistaResponse,
    LoginDeportistaResponse,
    LoginPasswordDeportistaRequest,
    MedicionesPortalResponse,
    MedicionPortalItem,
    MembresiaPortalResumenDto,
    PagoMembresiaPortalItem,
    PerfilDeportistaResponse,
    ProgresoResumenDto,
    RegistrarMedicionPortalRequest,
    ValidarPinDeportistaRequest,
    ValidarPinDeportistaResponse,
)

BOGOTA_TZ = ZoneInfo("America/Bogota")
PIN_VIGENCIA_MINUTOS = 15
SETUP_TOKEN_MINUTOS = 10
PORTAL_TOKEN_HORAS = 12
MAX_INTENTOS_PIN = 3


def _crear_token_portal(
    *,
    deportista_id: UUID,
    cuenta_id: UUID,
    gym_id: UUID,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=PORTAL_TOKEN_HORAS)
    payload: Dict[str, Any] = {
        "sub": str(deportista_id),
        "cuenta_id": str(cuenta_id),
        "gym_id": str(gym_id),
        "rol": "deportista",
        "type": "portal_access",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _crear_setup_token(
    *,
    deportista_id: UUID,
    gym_id: UUID,
    inv_id: UUID,
    jti: str,
    correo: str,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=SETUP_TOKEN_MINUTOS)
    payload: Dict[str, Any] = {
        "sub": str(deportista_id),
        "gym_id": str(gym_id),
        "inv_id": str(inv_id),
        "jti": jti,
        "correo": correo,
        "type": "portal_setup_password",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


class PortalDeportistaService:
    """Servicios de negocio y seguridad para el Portal del Deportista."""

    @staticmethod
    def _hoy_bogota() -> date:
        return datetime.now(BOGOTA_TZ).date()

    @classmethod
    async def _resolver_contexto_y_deportista(
        cls,
        session: AsyncSession,
        correo: str,
        subdominio: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Resuelve estrictamente el gimnasio a partir del `subdominio` obligatorio y busca al deportista
        únicamente dentro de ese gimnasio (RLS activo).
        Si el subdominio no existe o está inactivo, lanza 404 GIMNASIO_NO_ENCONTRADO.
        """
        correo_norm = correo.strip().lower()
        sub_norm = (subdominio or "").strip().lower()
        if not sub_norm:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "codigo": "GIMNASIO_NO_ENCONTRADO",
                    "mensaje": "No se pudo identificar el gimnasio. Ingresa desde el subdominio de tu gimnasio.",
                },
            )

        gym_id = await fijar_gimnasio_por_subdominio(session, sub_norm)
        if not gym_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "codigo": "GIMNASIO_NO_ENCONTRADO",
                    "mensaje": "El gimnasio solicitado no existe o no se encuentra disponible.",
                },
            )

        await verificar_suscripcion_operativa(session, gym_id)
        return await cls._buscar_deportista_en_gym(session, gym_id, correo_norm)

    @staticmethod
    async def _buscar_deportista_en_gym(
        session: AsyncSession,
        gym_id: UUID,
        correo_norm: str,
    ) -> Optional[Dict[str, Any]]:
        await fijar_gimnasio(session, gym_id)
        query = text("""
            SELECT d.id AS deportista_id,
                   d.gimnasio_id,
                   d.nombre,
                   d.documento,
                   d.correo,
                   d.telefono,
                   d.activo AS deportista_activo,
                   t.nombre AS gimnasio_nombre,
                   t.subdominio,
                   t.activo AS tenant_activo,
                   ca.id AS cuenta_id,
                   ca.hash_password,
                   ca.activa AS cuenta_activa
            FROM platform.deportistas d
            JOIN platform.tenant t ON t.id = d.gimnasio_id
            LEFT JOIN platform.cuentas_app ca ON ca.deportista_id = d.id
            WHERE d.gimnasio_id = :gym_id
              AND lower(d.correo::text) = :correo
              AND d.deleted_at IS NULL
              AND d.activo = true
              AND t.activo = true
            ORDER BY
              (ca.id IS NOT NULL) DESC,
              (SELECT count(*) FROM platform.mediciones_corporales mc WHERE mc.deportista_id = d.id) DESC,
              (SELECT count(*) FROM platform.checkins ch WHERE ch.deportista_id = d.id) DESC,
              d.created_at DESC
            LIMIT 1
        """)
        res = await session.execute(query, {"gym_id": gym_id, "correo": correo_norm})
        row = res.mappings().first()
        return dict(row) if row else None

    # =====================================================================
    # 1. FLUJO DE ACCESO, PIN ANTI-ENUMERACIÓN Y CREACIÓN DE CONTRASEÑA
    # =====================================================================

    @classmethod
    async def iniciar_acceso(
        cls,
        session: AsyncSession,
        data: IniciarAccesoDeportistaRequest,
    ) -> IniciarAccesoDeportistaResponse:
        correo = data.correo.strip().lower()
        mensaje_pin = (
            f"Hemos enviado un código PIN de 6 dígitos al correo {correo}. "
            f"Revisa tu bandeja de entrada para continuar."
        )

        info = await cls._resolver_contexto_y_deportista(session, correo, data.subdominio)

        if not info:
            # Defensa contra enumeración de correos y ataques de tiempo (Timing Attack):
            # Se realiza un cálculo de hash equivalente y se devuelve exactamente el mismo mensaje
            # indicando que se envió el PIN al correo proporcionado.
            _ = hash_token(f"anti_enum_dummy:{correo}:{secrets.token_hex(16)}")
            return IniciarAccesoDeportistaResponse(
                paso_siguiente="pin",
                correo=correo,
                mensaje=mensaje_pin,
                vigencia_minutos=PIN_VIGENCIA_MINUTOS,
            )

        gym_id: UUID = info["gimnasio_id"]
        deportista_id: UUID = info["deportista_id"]
        await verificar_suscripcion_operativa(session, gym_id)

        # Si ya tiene cuenta activa con contraseña y no pidió expresamente un PIN (olvido/reenvío),
        # pasa al paso de ingresar su contraseña.
        if info.get("cuenta_id") and info.get("cuenta_activa") and info.get("hash_password") and not data.forzar_pin:
            return IniciarAccesoDeportistaResponse(
                paso_siguiente="password",
                correo=correo,
                mensaje="Ingresa tu contraseña para acceder a tu portal de deportista.",
                vigencia_minutos=PIN_VIGENCIA_MINUTOS,
            )

        # Control anti-abuso: máximo 5 códigos emitidos en los últimos 10 minutos para este deportista
        res_rate = await session.execute(
            text("""
                SELECT COUNT(*) FROM platform.invitaciones_app
                WHERE gimnasio_id = :gym_id
                  AND deportista_id = :dep_id
                  AND created_at >= (now() - interval '10 minutes')
            """),
            {"gym_id": gym_id, "dep_id": deportista_id},
        )
        if (res_rate.scalar() or 0) >= 5:
            # Incluso en límite de envíos, no revelamos existencia de forma insegura, pero informamos esperar
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "codigo": "DEMASIADOS_INTENTOS_PIN",
                    "mensaje": "Has solicitado demasiados códigos recientemente. Espera unos minutos o revisa tu correo.",
                },
            )

        # Invalidar cualquier PIN pendiente anterior del deportista
        await session.execute(
            text("""
                UPDATE platform.invitaciones_app
                SET estado = 'expirada'
                WHERE gimnasio_id = :gym_id
                  AND deportista_id = :dep_id
                  AND estado = 'pendiente'
            """),
            {"gym_id": gym_id, "dep_id": deportista_id},
        )

        # Generar PIN criptográfico de 6 dígitos (100000 - 999999)
        pin_plano = f"{secrets.randbelow(900000) + 100000:06d}"
        pin_hash = hash_token(f"pin:{gym_id}:{deportista_id}:{pin_plano}")
        nonce = secrets.token_hex(6)
        codigo_compuesto = f"{pin_hash}:0:{nonce}"
        expira_en = datetime.now(timezone.utc) + timedelta(minutes=PIN_VIGENCIA_MINUTOS)

        await session.execute(
            text("""
                INSERT INTO platform.invitaciones_app (
                    gimnasio_id, deportista_id, codigo_hash, estado, expira_en
                ) VALUES (
                    :gym_id, :dep_id, :codigo_hash, 'pendiente', :expira_en
                )
            """),
            {
                "gym_id": gym_id,
                "dep_id": deportista_id,
                "codigo_hash": codigo_compuesto,
                "expira_en": expira_en,
            },
        )

        correo_obj = correo_pin_portal_deportista(
            destinatario=correo,
            nombre=info["nombre"],
            gimnasio=info["gimnasio_nombre"],
            pin=pin_plano,
            vigencia_minutos=PIN_VIGENCIA_MINUTOS,
        )

        async def _enviar_pin() -> None:
            await email_adaptador.enviar(correo_obj)

        on_commit(session, _enviar_pin)

        return IniciarAccesoDeportistaResponse(
            paso_siguiente="pin",
            correo=correo,
            mensaje=mensaje_pin,
            vigencia_minutos=PIN_VIGENCIA_MINUTOS,
        )

    @classmethod
    async def validar_pin(
        cls,
        session: AsyncSession,
        data: ValidarPinDeportistaRequest,
    ) -> ValidarPinDeportistaResponse:
        correo = data.correo.strip().lower()
        error_generico = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "codigo": "PIN_INVALIDO",
                "mensaje": "El código PIN ingresado es incorrecto o ha expirado.",
            },
        )

        info = await cls._resolver_contexto_y_deportista(session, correo, data.subdominio)
        if not info:
            _ = hash_token(f"dummy_pin:{correo}:{data.pin}")
            raise error_generico

        gym_id: UUID = info["gimnasio_id"]
        deportista_id: UUID = info["deportista_id"]

        res_inv = await session.execute(
            text("""
                SELECT id, codigo_hash, expira_en
                FROM platform.invitaciones_app
                WHERE gimnasio_id = :gym_id
                  AND deportista_id = :dep_id
                  AND estado = 'pendiente'
                  AND expira_en > now()
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
            """),
            {"gym_id": gym_id, "dep_id": deportista_id},
        )
        inv = res_inv.mappings().first()
        if not inv:
            raise error_generico

        partes = str(inv["codigo_hash"]).split(":")
        if len(partes) != 3 or partes[0] == "SETUP":
            raise error_generico

        stored_hash, intentos_str, nonce = partes
        try:
            intentos = int(intentos_str)
        except ValueError:
            intentos = 0

        expected_hash = hash_token(f"pin:{gym_id}:{deportista_id}:{data.pin}")

        if not hmac.compare_digest(stored_hash, expected_hash):
            intentos += 1
            if intentos >= MAX_INTENTOS_PIN:
                await session.execute(
                    text("""
                        UPDATE platform.invitaciones_app
                        SET estado = 'expirada', codigo_hash = :ch
                        WHERE id = :id
                    """),
                    {"ch": f"{stored_hash}:{intentos}:{nonce}", "id": inv["id"]},
                )
                await session.commit()
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "codigo": "PIN_BLOQUEADO",
                        "mensaje": "Has superado el máximo de 3 intentos permitidos. Solicita un nuevo código PIN.",
                    },
                )

            await session.execute(
                text("""
                    UPDATE platform.invitaciones_app
                    SET codigo_hash = :ch
                    WHERE id = :id
                """),
                {"ch": f"{stored_hash}:{intentos}:{nonce}", "id": inv["id"]},
            )
            await session.commit()
            restantes = MAX_INTENTOS_PIN - intentos
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "codigo": "PIN_INVALIDO",
                    "mensaje": f"Código PIN incorrecto. Te {'queda 1 intento' if restantes == 1 else f'quedan {restantes} intentos'}.",
                },
            )

        # PIN correcto: transformar la invitación en un ticket de configuración de contraseña de un solo uso
        setup_jti = secrets.token_hex(16)
        nueva_expiracion = datetime.now(timezone.utc) + timedelta(minutes=SETUP_TOKEN_MINUTOS)
        await session.execute(
            text("""
                UPDATE platform.invitaciones_app
                SET codigo_hash = :ch, expira_en = :exp
                WHERE id = :id
            """),
            {"ch": f"SETUP:{setup_jti}", "exp": nueva_expiracion, "id": inv["id"]},
        )

        setup_token = _crear_setup_token(
            deportista_id=deportista_id,
            gym_id=gym_id,
            inv_id=inv["id"],
            jti=setup_jti,
            correo=correo,
        )

        return ValidarPinDeportistaResponse(
            valido=True,
            setup_token=setup_token,
            mensaje="Código PIN verificado. Ahora define tu contraseña segura.",
        )

    @classmethod
    async def establecer_password(
        cls,
        session: AsyncSession,
        data: EstablecerPasswordDeportistaRequest,
    ) -> LoginDeportistaResponse:
        try:
            payload = decode_access_token(data.setup_token)
            if payload.get("type") != "portal_setup_password":
                raise ValueError("Tipo de token inválido")
            deportista_id = UUID(payload["sub"])
            gym_id = UUID(payload["gym_id"])
            inv_id = UUID(payload["inv_id"])
            jti = str(payload["jti"])
            correo = str(payload["correo"]).strip().lower()
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "codigo": "TOKEN_SETUP_EXPIRADO",
                    "mensaje": "La sesión para crear tu contraseña expiró. Solicita un nuevo código PIN.",
                },
            )

        await fijar_gimnasio(session, gym_id)
        await verificar_suscripcion_operativa(session, gym_id)

        # Verificar y consumir el ticket en invitaciones_app con bloqueo FOR UPDATE
        res_inv = await session.execute(
            text("""
                SELECT id, codigo_hash
                FROM platform.invitaciones_app
                WHERE id = :inv_id
                  AND gimnasio_id = :gym_id
                  AND deportista_id = :dep_id
                  AND estado = 'pendiente'
                  AND expira_en > now()
                FOR UPDATE
            """),
            {"inv_id": inv_id, "gym_id": gym_id, "dep_id": deportista_id},
        )
        inv = res_inv.mappings().first()
        if not inv or not hmac.compare_digest(str(inv["codigo_hash"]), f"SETUP:{jti}"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "codigo": "TOKEN_SETUP_USADO",
                    "mensaje": "Este código de activación ya fue utilizado o expiró.",
                },
            )

        # Quemar invitación
        await session.execute(
            text("UPDATE platform.invitaciones_app SET estado = 'usada' WHERE id = :id"),
            {"id": inv_id},
        )

        # Verificar ficha activa del deportista
        res_dep = await session.execute(
            text("""
                SELECT d.id, d.nombre, d.documento, d.correo, d.telefono,
                       t.nombre AS gimnasio_nombre, t.subdominio
                FROM platform.deportistas d
                JOIN platform.tenant t ON t.id = d.gimnasio_id
                WHERE d.id = :dep_id AND d.gimnasio_id = :gym_id AND d.deleted_at IS NULL AND d.activo = true
            """),
            {"dep_id": deportista_id, "gym_id": gym_id},
        )
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Ficha de deportista no encontrada o inactiva."},
            )

        pwd_hash = hash_password(data.password)

        # Crear o actualizar cuenta en platform.cuentas_app
        res_existente = await session.execute(
            text("SELECT id FROM platform.cuentas_app WHERE deportista_id = :dep_id OR lower(correo::text) = :correo LIMIT 1"),
            {"dep_id": deportista_id, "correo": correo},
        )
        cuenta_existente = res_existente.mappings().first()

        if cuenta_existente:
            res_cuenta = await session.execute(
                text("""
                    UPDATE platform.cuentas_app
                    SET gimnasio_id = :gym_id,
                        deportista_id = :dep_id,
                        correo = :correo,
                        hash_password = :hash_password,
                        activa = true,
                        ultimo_ingreso = now(),
                        updated_at = now()
                    WHERE id = :cuenta_id
                    RETURNING id
                """),
                {
                    "gym_id": gym_id,
                    "dep_id": deportista_id,
                    "correo": correo,
                    "hash_password": pwd_hash,
                    "cuenta_id": cuenta_existente["id"],
                },
            )
            cuenta_id = res_cuenta.scalar_one()
        else:
            res_cuenta = await session.execute(
                text("""
                    INSERT INTO platform.cuentas_app (
                        gimnasio_id, deportista_id, correo, hash_password, activa, ultimo_ingreso
                    ) VALUES (
                        :gym_id, :dep_id, :correo, :hash_password, true, now()
                    )
                    RETURNING id
                """),
                {
                    "gym_id": gym_id,
                    "dep_id": deportista_id,
                    "correo": correo,
                    "hash_password": pwd_hash,
                },
            )
            cuenta_id = res_cuenta.scalar_one()

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=None,
            actor_nombre=f"Deportista: {dep['nombre']}",
            accion="ACTIVAR_PASSWORD_PORTAL",
            entidad="cuentas_app",
            entidad_id=str(cuenta_id),
            detalle={"deportista_id": str(deportista_id), "origen": "portal_deportista"},
        )

        access_token = _crear_token_portal(
            deportista_id=deportista_id,
            cuenta_id=cuenta_id,
            gym_id=gym_id,
        )

        return LoginDeportistaResponse(
            access_token=access_token,
            deportista=DeportistaAuthPerfilDto(
                id=deportista_id,
                cuenta_id=cuenta_id,
                gimnasio_id=gym_id,
                gimnasio_nombre=dep["gimnasio_nombre"],
                subdominio=dep["subdominio"],
                nombre=dep["nombre"],
                documento=dep["documento"],
                correo=str(dep["correo"] or correo),
                telefono=dep["telefono"],
            ),
        )

    @staticmethod
    async def _registrar_intento_fallido(gym_id: Optional[UUID], correo: str, ip: Optional[str]) -> None:
        """
        Registra un intento fallido en una conexión independiente con su propio commit,
        garantizando que persista incluso cuando el request principal lance un error 401
        y la sesión del request haga rollback.
        """
        async with async_session_maker() as audit_session:
            async with audit_session.begin():
                await audit_session.execute(
                    text("""
                        INSERT INTO platform.intentos_login_deportista (gimnasio_id, correo, ip, exito)
                        VALUES (:gym, :correo, :ip, false)
                    """),
                    {"gym": gym_id, "correo": correo, "ip": ip},
                )

    @classmethod
    async def login_password(
        cls,
        session: AsyncSession,
        data: LoginPasswordDeportistaRequest,
        client_ip: Optional[str] = None,
    ) -> LoginDeportistaResponse:
        # 1. Chequeo de intentos fallidos por IP (30 minutos, 15 intentos)
        if client_ip:
            intentos_ip = await session.execute(
                text("SELECT platform.intentos_fallidos_ip_deportista(CAST(:ip AS inet), now() - interval '30 minutes')"),
                {"ip": client_ip},
            )
            if (intentos_ip.scalar() or 0) >= 15:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "codigo": "IP_BLOQUEADA_TEMPORALMENTE",
                        "mensaje": "Demasiados intentos fallidos desde esta dirección IP. Bloqueada temporalmente por 30 minutos.",
                    },
                )

        correo = data.correo.strip().lower()
        credenciales_invalidas = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "codigo": "CREDENCIALES_INVALIDAS",
                "mensaje": "Correo electrónico o contraseña incorrectos.",
            },
        )

        info = await cls._resolver_contexto_y_deportista(session, correo, data.subdominio)
        gym_id = info["gimnasio_id"] if info else await fijar_gimnasio_por_subdominio(session, (data.subdominio or "").strip().lower())

        # 2. Control de fuerza bruta por cuenta específica de deportista en este gimnasio (30 minutos, 5 intentos)
        if gym_id:
            intentos_cuenta = await session.execute(text("""
                SELECT COUNT(*) FROM platform.intentos_login_deportista
                WHERE gimnasio_id = :gym_id AND lower(correo::text) = :correo AND exito = false
                  AND created_at >= (now() - interval '30 minutes')
                  AND created_at > COALESCE(
                      (SELECT MAX(created_at) FROM platform.intentos_login_deportista
                       WHERE gimnasio_id = :gym_id AND lower(correo::text) = :correo AND exito = true),
                      '1970-01-01'::timestamptz
                  )
            """), {"gym_id": gym_id, "correo": correo})
            if (intentos_cuenta.scalar() or 0) >= 5:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "codigo": "CUENTA_BLOQUEADA_TEMPORALMENTE",
                        "mensaje": "Demasiados intentos fallidos para esta cuenta. Bloqueada temporalmente por 30 minutos.",
                    },
                )

        if not info or not info.get("cuenta_id") or not info.get("hash_password"):
            if gym_id:
                await cls._registrar_intento_fallido(gym_id, correo, client_ip)
            _ = hash_token(f"dummy_login:{correo}")
            raise credenciales_invalidas

        if not info.get("cuenta_activa") or not info.get("deportista_activo"):
            if gym_id:
                await cls._registrar_intento_fallido(gym_id, correo, client_ip)
            raise credenciales_invalidas

        if not verify_password(data.password, info["hash_password"]):
            if gym_id:
                await cls._registrar_intento_fallido(gym_id, correo, client_ip)
            raise credenciales_invalidas

        gym_id: UUID = info["gimnasio_id"]
        deportista_id: UUID = info["deportista_id"]
        cuenta_id: UUID = info["cuenta_id"]

        await verificar_suscripcion_operativa(session, gym_id)

        # Registrar login exitoso (resetea ventana de fuerza bruta)
        await session.execute(
            text("""
                INSERT INTO platform.intentos_login_deportista (gimnasio_id, correo, ip, exito)
                VALUES (:gym, :correo, :ip, true)
            """),
            {"gym": gym_id, "correo": correo, "ip": client_ip},
        )

        await session.execute(
            text("UPDATE platform.cuentas_app SET ultimo_ingreso = now(), updated_at = now() WHERE id = :id"),
            {"id": cuenta_id},
        )

        access_token = _crear_token_portal(
            deportista_id=deportista_id,
            cuenta_id=cuenta_id,
            gym_id=gym_id,
        )

        return LoginDeportistaResponse(
            access_token=access_token,
            deportista=DeportistaAuthPerfilDto(
                id=deportista_id,
                cuenta_id=cuenta_id,
                gimnasio_id=gym_id,
                gimnasio_nombre=info["gimnasio_nombre"],
                subdominio=info["subdominio"],
                nombre=info["nombre"],
                documento=info["documento"],
                correo=str(info["correo"] or correo),
                telefono=info["telefono"],
            ),
        )

    # =====================================================================
    # 2. PERFIL Y MEMBRESÍA ACTUAL (CERO IDOR)
    # =====================================================================

    @classmethod
    async def obtener_perfil(
        cls,
        session: AsyncSession,
        dep: AuthenticatedDeportista,
    ) -> PerfilDeportistaResponse:
        hoy = cls._hoy_bogota()

        res_dep = await session.execute(
            text("""
                SELECT d.id, d.documento, d.nombre, d.correo, d.telefono, d.sexo,
                       d.fecha_nacimiento, d.altura_cm, d.acudiente_nombre, d.activo, d.version,
                       t.dias_gracia_mora, t.dias_umbral_por_vencer
                FROM platform.deportistas d
                JOIN platform.tenant t ON t.id = d.gimnasio_id
                WHERE d.id = :dep_id AND d.gimnasio_id = :gym_id AND d.deleted_at IS NULL
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        row = res_dep.mappings().one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail={"codigo": "NO_ENCONTRADO", "mensaje": "Perfil no encontrado"})

        # Consultar membresía más reciente
        res_memb = await session.execute(
            text("""
                SELECT m.id, m.fecha_inicio, m.fecha_vencimiento, m.cancelada,
                       COALESCE(m.plan_precio_vendido, p.precio) AS precio,
                       p.nombre AS plan_nombre,
                       EXISTS (
                           SELECT 1 FROM platform.congelamientos c
                           WHERE c.membresia_id = m.id AND c.gimnasio_id = m.gimnasio_id
                             AND c.fecha_inicio <= :hoy
                             AND (c.fecha_fin IS NULL OR c.fecha_fin >= :hoy)
                       ) AS congelada
                FROM platform.membresias m
                JOIN platform.planes p ON p.id = m.plan_id
                WHERE m.deportista_id = :dep_id AND m.gimnasio_id = :gym_id
                ORDER BY m.cancelada ASC, m.fecha_vencimiento DESC, m.created_at DESC
                LIMIT 1
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id, "hoy": hoy},
        )
        m_row = res_memb.mappings().first()

        estado_general = "sin_membresia"
        membresia_dto: Optional[MembresiaPortalResumenDto] = None

        if m_row:
            dias_restantes = (m_row["fecha_vencimiento"] - hoy).days
            gracia = int(row["dias_gracia_mora"] or 3)
            umbral = int(row["dias_umbral_por_vencer"] or 5)

            if m_row["cancelada"]:
                estado_m = "cancelado"
            elif m_row["congelada"]:
                estado_m = "congelado"
            elif dias_restantes < -gracia:
                estado_m = "vencido"
            elif dias_restantes < 0:
                estado_m = "en_gracia"
            elif dias_restantes <= umbral:
                estado_m = "por_vencer"
            else:
                estado_m = "activo"

            estado_general = estado_m

            # Si hay pagos acumulados o membresías encadenadas, calcular la fecha de inicio del ciclo continuo
            res_inicio = await session.execute(
                text("""
                    SELECT MIN(fecha_inicio) AS inicio_cobertura
                    FROM platform.membresias
                    WHERE deportista_id = :dep_id AND gimnasio_id = :gym_id
                      AND fecha_vencimiento >= :hoy
                """),
                {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id, "hoy": hoy},
            )
            ini_row = res_inicio.mappings().first()
            fecha_inicio_calc = m_row["fecha_inicio"]
            if ini_row and ini_row["inicio_cobertura"] and ini_row["inicio_cobertura"] <= hoy:
                fecha_inicio_calc = ini_row["inicio_cobertura"]

            # Plan activo para el día de hoy si existe uno con cobertura actual
            plan_nombre_actual = m_row["plan_nombre"]
            res_plan_hoy = await session.execute(
                text("""
                    SELECT p.nombre
                    FROM platform.membresias m
                    JOIN platform.planes p ON p.id = m.plan_id
                    WHERE m.deportista_id = :dep_id AND m.gimnasio_id = :gym_id
                      AND m.fecha_inicio <= :hoy AND m.fecha_vencimiento >= :hoy
                    ORDER BY m.created_at DESC
                    LIMIT 1
                """),
                {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id, "hoy": hoy},
            )
            plan_hoy_row = res_plan_hoy.mappings().first()
            if plan_hoy_row:
                plan_nombre_actual = plan_hoy_row["nombre"]

            membresia_dto = MembresiaPortalResumenDto(
                id=m_row["id"],
                plan_nombre=plan_nombre_actual,
                fecha_inicio=fecha_inicio_calc,
                fecha_vencimiento=m_row["fecha_vencimiento"],
                dias_restantes=dias_restantes,
                estado=estado_m,
                congelada=bool(m_row["congelada"]),
                precio=Decimal(str(m_row["precio"] or 0)),
            )

        # Estadísticas de días únicos entrenados
        inicio_mes = hoy.replace(day=1)
        res_asist = await session.execute(
            text("""
                SELECT
                    COUNT(DISTINCT (ts_utc AT TIME ZONE 'America/Bogota')::date) FILTER (WHERE (ts_utc AT TIME ZONE 'America/Bogota')::date >= :inicio_mes) AS mes,
                    COUNT(DISTINCT (ts_utc AT TIME ZONE 'America/Bogota')::date) AS total
                FROM platform.checkins
                WHERE deportista_id = :dep_id AND gimnasio_id = :gym_id AND tipo = 'ingreso' AND resultado = 'abrio'
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id, "inicio_mes": inicio_mes},
        )
        asist_row = res_asist.mappings().one()

        # Última medición corporal
        res_med = await session.execute(
            text("""
                SELECT peso, grasa_pct, masa_muscular
                FROM platform.mediciones_corporales
                WHERE deportista_id = :dep_id AND gimnasio_id = :gym_id
                ORDER BY fecha DESC, created_at DESC
                LIMIT 1
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        med_row = res_med.mappings().first()

        return PerfilDeportistaResponse(
            id=row["id"],
            gimnasio_nombre=dep.gimnasio_nombre,
            subdominio=dep.subdominio,
            documento=row["documento"],
            nombre=row["nombre"],
            correo=str(row["correo"]) if row["correo"] else dep.correo,
            telefono=row["telefono"],
            sexo=row["sexo"],
            fecha_nacimiento=row["fecha_nacimiento"],
            altura_cm=row["altura_cm"],
            acudiente_nombre=row["acudiente_nombre"],
            estado_general=estado_general,
            membresia_actual=membresia_dto,
            total_asistencias_mes=int(asist_row["mes"] or 0),
            total_asistencias_historico=int(asist_row["total"] or 0),
            ultimo_peso_kg=med_row["peso"] if med_row else None,
            ultimo_grasa_pct=med_row["grasa_pct"] if med_row else None,
            ultimo_masa_muscular_kg=med_row["masa_muscular"] if med_row else None,
            version=row["version"],
        )

    @classmethod
    async def actualizar_perfil(
        cls,
        session: AsyncSession,
        dep: AuthenticatedDeportista,
        req: ActualizarPerfilDeportistaRequest,
    ) -> PerfilDeportistaResponse:
        if req.fecha_nacimiento and req.fecha_nacimiento > cls._hoy_bogota():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "FECHA_INVALIDA", "mensaje": "La fecha de nacimiento no puede ser futura."},
            )

        await session.execute(
            text("""
                UPDATE platform.deportistas
                SET nombre = :nombre,
                    telefono = :telefono,
                    sexo = COALESCE(:sexo, sexo),
                    fecha_nacimiento = COALESCE(:fecha_nacimiento, fecha_nacimiento),
                    altura_cm = COALESCE(:altura_cm, altura_cm),
                    acudiente_nombre = :acudiente_nombre,
                    version = version + 1,
                    updated_at = now()
                WHERE id = :dep_id AND gimnasio_id = :gym_id AND deleted_at IS NULL
            """),
            {
                "nombre": req.nombre,
                "telefono": req.telefono,
                "sexo": req.sexo,
                "fecha_nacimiento": req.fecha_nacimiento,
                "altura_cm": req.altura_cm,
                "acudiente_nombre": req.acudiente_nombre,
                "dep_id": dep.deportista_id,
                "gym_id": dep.gimnasio_id,
            },
        )

        await AuditService.registrar(
            session=session,
            gimnasio_id=dep.gimnasio_id,
            actor_id=None,
            actor_nombre=f"Deportista: {req.nombre}",
            accion="ACTUALIZAR_PERFIL_DEPORTISTA",
            entidad="deportistas",
            entidad_id=str(dep.deportista_id),
            detalle={
                "nombre": req.nombre,
                "telefono": req.telefono,
                "origen": "portal_deportista",
            },
        )

        return await cls.obtener_perfil(session, dep)

    # =====================================================================
    # 3. PAGOS DE MEMBRESÍA Y COMPRAS EN TIENDA
    # =====================================================================

    @classmethod
    async def obtener_finanzas(
        cls,
        session: AsyncSession,
        dep: AuthenticatedDeportista,
    ) -> FinanzasDeportistaResponse:
        # 1. Pagos de membresías directas y pagos de paquetes donde el deportista es titular o miembro
        res_pagos = await session.execute(
            text("""
                SELECT DISTINCT ON (pm.id)
                       pm.id,
                       COALESCE(pm.membresia_id, m.id, m_paq.id) AS membresia_id,
                       p.nombre AS plan_nombre,
                       pm.monto,
                       pm.metodo,
                       COALESCE(pm.dias_agregados, p.duracion_dias, 30) AS dias_agregados,
                       COALESCE(m.fecha_inicio, m_paq.fecha_inicio) AS fecha_inicio,
                       COALESCE(m.fecha_vencimiento, m_paq.fecha_vencimiento) AS fecha_vencimiento,
                       pm.anulado,
                       pm.created_at
                FROM platform.pagos_membresia pm
                LEFT JOIN platform.membresias m ON m.id = pm.membresia_id
                LEFT JOIN platform.paquetes paq ON paq.id = pm.paquete_id
                LEFT JOIN platform.membresias m_paq ON m_paq.paquete_id = paq.id AND m_paq.deportista_id = :dep_id
                JOIN platform.planes p ON p.id = COALESCE(m.plan_id, paq.plan_id)
                WHERE pm.gimnasio_id = :gym_id
                  AND (
                    m.deportista_id = :dep_id
                    OR paq.titular_id = :dep_id
                    OR m_paq.id IS NOT NULL
                  )
                ORDER BY pm.id, pm.created_at DESC
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        pagos_raw = [dict(r) for r in res_pagos.mappings().all()]
        # Ordenar cronológicamente descendente
        pagos_raw.sort(key=lambda x: x["created_at"], reverse=True)
        pagos_list = [PagoMembresiaPortalItem(**r) for r in pagos_raw]

        # 2. Compras en tienda / POS asociadas al deportista
        res_ventas = await session.execute(
            text("""
                SELECT v.id, v.total, v.metodo, v.anulada, v.created_at
                FROM platform.ventas v
                WHERE v.deportista_id = :dep_id
                  AND v.gimnasio_id = :gym_id
                ORDER BY v.created_at DESC
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        ventas_raw = [dict(r) for r in res_ventas.mappings().all()]

        items_por_venta: Dict[UUID, List[CompraItemPortalDto]] = {}
        if ventas_raw:
            venta_ids = [v["id"] for v in ventas_raw]
            res_items = await session.execute(
                text("""
                    SELECT id, venta_id, tipo, descripcion, cantidad, precio_unitario, subtotal
                    FROM platform.venta_items
                    WHERE gimnasio_id = :gym_id AND venta_id = ANY(:venta_ids)
                    ORDER BY id ASC
                """),
                {"gym_id": dep.gimnasio_id, "venta_ids": venta_ids},
            )
            for item_row in res_items.mappings().all():
                vid = item_row["venta_id"]
                items_por_venta.setdefault(vid, []).append(
                    CompraItemPortalDto(
                        id=item_row["id"],
                        tipo=item_row["tipo"],
                        descripcion=item_row["descripcion"],
                        cantidad=item_row["cantidad"],
                        precio_unitario=item_row["precio_unitario"],
                        subtotal=item_row["subtotal"],
                    )
                )

        compras_list = [
            CompraTiendaPortalItem(
                id=v["id"],
                total=v["total"],
                metodo=v["metodo"],
                anulada=v["anulada"],
                created_at=v["created_at"],
                items=items_por_venta.get(v["id"], []),
            )
            for v in ventas_raw
        ]

        total_membresias = sum(
            (p.monto for p in pagos_list if not p.anulado),
            Decimal("0.00"),
        )
        total_compras = sum(
            (c.total for c in compras_list if not c.anulada),
            Decimal("0.00"),
        )

        return FinanzasDeportistaResponse(
            total_invertido_membresias=total_membresias,
            total_compras_tienda=total_compras,
            cantidad_pagos_membresia=sum(1 for p in pagos_list if not p.anulado),
            cantidad_compras_tienda=sum(1 for c in compras_list if not c.anulada),
            pagos_membresias=pagos_list,
            compras_tienda=compras_list,
        )

    # =====================================================================
    # 4. MEDICIONES CORPORALES Y CÁLCULO DE PROGRESO
    # =====================================================================

    @staticmethod
    def _calcular_imc(peso: Optional[Decimal], altura_cm: Optional[Decimal]) -> Optional[Decimal]:
        if not peso or not altura_cm or peso <= 0 or altura_cm <= 0:
            return None
        alt_m = float(altura_cm) / 100.0
        imc_val = float(peso) / (alt_m * alt_m)
        return Decimal(f"{imc_val:.1f}")

    @classmethod
    async def obtener_mediciones(
        cls,
        session: AsyncSession,
        dep: AuthenticatedDeportista,
    ) -> MedicionesPortalResponse:
        res_dep = await session.execute(
            text("""
                SELECT sexo, altura_cm
                FROM platform.deportistas
                WHERE id = :dep_id AND gimnasio_id = :gym_id
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        dep_info = res_dep.mappings().first()
        altura_cm = dep_info["altura_cm"] if dep_info else None
        sexo = dep_info["sexo"] if dep_info else "M"

        res_meds = await session.execute(
            text("""
                SELECT mc.id, mc.fecha, mc.peso, mc.grasa_pct, mc.masa_muscular,
                       mc.cintura, mc.cadera, mc.pecho, mc.brazo, mc.pierna,
                       mc.registrado_por, s.nombre AS registrado_por_nombre, mc.created_at
                FROM platform.mediciones_corporales mc
                LEFT JOIN platform.staff s ON s.id = mc.registrado_por
                WHERE mc.deportista_id = :dep_id AND mc.gimnasio_id = :gym_id
                ORDER BY mc.fecha DESC, mc.created_at DESC
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        rows = res_meds.mappings().all()

        historial: List[MedicionPortalItem] = []
        for r in rows:
            es_staff = r["registrado_por"] is not None
            historial.append(
                MedicionPortalItem(
                    id=r["id"],
                    fecha=r["fecha"],
                    peso=r["peso"],
                    imc=cls._calcular_imc(r["peso"], altura_cm),
                    grasa_pct=r["grasa_pct"],
                    masa_muscular=r["masa_muscular"],
                    cintura=r["cintura"],
                    cadera=r["cadera"],
                    pecho=r["pecho"],
                    brazo=r["brazo"],
                    pierna=r["pierna"],
                    origen="staff" if es_staff else "deportista",
                    registrado_por_nombre=r["registrado_por_nombre"] if es_staff else "Registrado por ti",
                    created_at=r["created_at"],
                )
            )

        resumen = ProgresoResumenDto(
            total_registros=len(historial),
            altura_cm=altura_cm,
            sexo=sexo,
        )

        if historial:
            actual = historial[0]
            inicial = historial[-1]

            resumen.peso_actual = actual.peso
            resumen.peso_inicial = inicial.peso
            if actual.peso is not None and inicial.peso is not None:
                resumen.cambio_peso = actual.peso - inicial.peso

            resumen.grasa_actual = actual.grasa_pct
            resumen.grasa_inicial = inicial.grasa_pct
            if actual.grasa_pct is not None and inicial.grasa_pct is not None:
                resumen.cambio_grasa = actual.grasa_pct - inicial.grasa_pct

            resumen.musculo_actual = actual.masa_muscular
            resumen.musculo_inicial = inicial.masa_muscular
            if actual.masa_muscular is not None and inicial.masa_muscular is not None:
                resumen.cambio_musculo = actual.masa_muscular - inicial.masa_muscular

            resumen.cintura_actual = actual.cintura
            resumen.cintura_inicial = inicial.cintura
            if actual.cintura is not None and inicial.cintura is not None:
                resumen.cambio_cintura = actual.cintura - inicial.cintura

            resumen.imc_actual = actual.imc

        return MedicionesPortalResponse(resumen=resumen, historial=historial)

    @classmethod
    async def registrar_medicion(
        cls,
        session: AsyncSession,
        dep: AuthenticatedDeportista,
        req: RegistrarMedicionPortalRequest,
    ) -> MedicionPortalItem:
        hoy = cls._hoy_bogota()
        fecha_toma = req.fecha or hoy
        if fecha_toma > hoy:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "FECHA_FUTURA", "mensaje": "La fecha de la medición no puede ser futura."},
            )

        res_dep = await session.execute(
            text("""
                SELECT sexo, altura_cm, fecha_nacimiento
                FROM platform.deportistas
                WHERE id = :dep_id AND gimnasio_id = :gym_id AND deleted_at IS NULL
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )
        dep_row = res_dep.mappings().one_or_none()
        if not dep_row:
            raise HTTPException(status_code=404, detail={"codigo": "NO_ENCONTRADO", "mensaje": "Deportista no encontrado"})

        sexo_efectivo = req.sexo or dep_row["sexo"] or "M"
        altura_efectiva = req.altura_cm or dep_row["altura_cm"]

        if req.sexo is not None or req.altura_cm is not None:
            await session.execute(
                text("""
                    UPDATE platform.deportistas
                    SET sexo = COALESCE(:sexo, sexo),
                        altura_cm = COALESCE(:altura_cm, altura_cm),
                        updated_at = now()
                    WHERE id = :dep_id AND gimnasio_id = :gym_id
                """),
                {
                    "sexo": req.sexo,
                    "altura_cm": req.altura_cm,
                    "dep_id": dep.deportista_id,
                    "gym_id": dep.gimnasio_id,
                },
            )

        fecha_nac = dep_row["fecha_nacimiento"]
        edad_anios = 28
        if fecha_nac:
            edad_anios = max(
                10,
                min(
                    95,
                    fecha_toma.year
                    - fecha_nac.year
                    - ((fecha_toma.month, fecha_toma.day) < (fecha_nac.month, fecha_nac.day)),
                ),
            )

        grasa_pct_calc, masa_muscular_calc = DeportistasService._calcular_medidas_derivadas(
            sexo=sexo_efectivo,
            altura_cm=altura_efectiva,
            edad_anios=edad_anios,
            peso=req.peso,
            cintura=req.cintura,
            cadera=req.cadera,
            brazo=req.brazo,
            pierna=req.pierna,
        )

        res_ins = await session.execute(
            text("""
                INSERT INTO platform.mediciones_corporales (
                    gimnasio_id, deportista_id, fecha, peso, grasa_pct, masa_muscular,
                    cintura, cadera, brazo, pierna, pecho, registrado_por, created_at
                ) VALUES (
                    :gym_id, :dep_id, :fecha, :peso, :grasa_pct, :masa_muscular,
                    :cintura, :cadera, :brazo, :pierna, :pecho, NULL, now()
                )
                RETURNING id, fecha, peso, grasa_pct, masa_muscular,
                          cintura, cadera, pecho, brazo, pierna, created_at
            """),
            {
                "gym_id": dep.gimnasio_id,
                "dep_id": dep.deportista_id,
                "fecha": fecha_toma,
                "peso": req.peso,
                "grasa_pct": grasa_pct_calc,
                "masa_muscular": masa_muscular_calc,
                "cintura": req.cintura,
                "cadera": req.cadera,
                "brazo": req.brazo,
                "pierna": req.pierna,
                "pecho": req.pecho,
            },
        )
        m_row = res_ins.mappings().one()

        await AuditService.registrar(
            session=session,
            gimnasio_id=dep.gimnasio_id,
            actor_id=None,
            actor_nombre=f"Deportista: {dep.nombre}",
            accion="AUTORREGISTRAR_MEDICION_PORTAL",
            entidad="mediciones_corporales",
            entidad_id=str(m_row["id"]),
            detalle={
                "deportista_id": str(dep.deportista_id),
                "fecha": fecha_toma.isoformat(),
                "peso": str(req.peso),
                "origen": "portal_deportista",
            },
        )

        return MedicionPortalItem(
            id=m_row["id"],
            fecha=m_row["fecha"],
            peso=m_row["peso"],
            imc=cls._calcular_imc(m_row["peso"], altura_efectiva),
            grasa_pct=m_row["grasa_pct"],
            masa_muscular=m_row["masa_muscular"],
            cintura=m_row["cintura"],
            cadera=m_row["cadera"],
            pecho=m_row["pecho"],
            brazo=m_row["brazo"],
            pierna=m_row["pierna"],
            origen="deportista",
            registrado_por_nombre="Registrado por ti",
            created_at=m_row["created_at"],
        )

    # =====================================================================
    # 5. HISTORIAL Y RESUMEN DE ASISTENCIAS
    # =====================================================================

    @classmethod
    async def obtener_asistencias(
        cls,
        session: AsyncSession,
        dep: AuthenticatedDeportista,
    ) -> AsistenciasPortalResponse:
        hoy = cls._hoy_bogota()
        inicio_mes = hoy.replace(day=1)
        hace_30_dias = hoy - timedelta(days=30)

        res_stats = await session.execute(
            text("""
                SELECT
                    COUNT(DISTINCT (ts_utc AT TIME ZONE 'America/Bogota')::date) FILTER (WHERE (ts_utc AT TIME ZONE 'America/Bogota')::date >= :inicio_mes) AS mes_actual,
                    COUNT(DISTINCT (ts_utc AT TIME ZONE 'America/Bogota')::date) FILTER (WHERE (ts_utc AT TIME ZONE 'America/Bogota')::date >= :hace_30) AS ultimos_30,
                    COUNT(DISTINCT (ts_utc AT TIME ZONE 'America/Bogota')::date) AS totales
                FROM platform.checkins
                WHERE deportista_id = :dep_id AND gimnasio_id = :gym_id AND tipo = 'ingreso' AND resultado = 'abrio'
            """),
            {
                "dep_id": dep.deportista_id,
                "gym_id": dep.gimnasio_id,
                "inicio_mes": inicio_mes,
                "hace_30": hace_30_dias,
            },
        )
        st = res_stats.mappings().one()

        res_list = await session.execute(
            text("""
                SELECT id, metodo, resultado, ts_utc
                FROM platform.checkins
                WHERE deportista_id = :dep_id AND gimnasio_id = :gym_id AND tipo = 'ingreso'
                ORDER BY ts_utc DESC
                LIMIT 150
            """),
            {"dep_id": dep.deportista_id, "gym_id": dep.gimnasio_id},
        )

        historial: List[AsistenciaPortalItem] = []
        dias_mes_set = set()
        ultimo_ts_utc: Optional[datetime] = None

        for r in res_list.mappings().all():
            curr_ts = r["ts_utc"]
            # Deduplicar scans dentro de 3 minutos (180 segundos)
            if ultimo_ts_utc is not None and abs((ultimo_ts_utc - curr_ts).total_seconds()) < 180:
                continue

            ultimo_ts_utc = curr_ts
            ts_local = curr_ts.astimezone(BOGOTA_TZ)
            fecha_str = ts_local.strftime("%Y-%m-%d")
            hora_str = ts_local.strftime("%H:%M")
            if ts_local.date() >= inicio_mes:
                dias_mes_set.add(fecha_str)
            historial.append(
                AsistenciaPortalItem(
                    id=r["id"],
                    fecha_hora=r["ts_utc"],
                    fecha_local=fecha_str,
                    hora_local=hora_str,
                    metodo=r["metodo"],
                    resultado=r["resultado"],
                )
            )

        return AsistenciasPortalResponse(
            asistencias_mes_actual=int(st["mes_actual"] or 0),
            asistencias_ultimos_30_dias=int(st["ultimos_30"] or 0),
            asistencias_totales=int(st["totales"] or 0),
            dias_asistidos_mes=sorted(dias_mes_set),
            historial=historial,
        )

