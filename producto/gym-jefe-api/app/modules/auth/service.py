import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID, uuid4
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.config import settings
from app.core.database import async_session_maker, on_commit
from app.core.dependencies import gimnasio_suspendido_exception, verificar_suscripcion_operativa
from app.core.email import correo_recuperacion_password, email_adaptador, url_sistema_web
from app.core.security import (
    create_access_token,
    generate_secure_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.modules.auth.schemas import (
    ActualizarMatrizPermisosRequest,
    CambiarPasswordRequest,
    ConfirmarRecuperacionRequest,
    LoginRequest,
    LoginResponseDto,
    PermisoMatrizItemDto,
    RefreshResponseDto,
    RefreshTokenRequest,
    SolicitarRecuperacionRequest,
    UsuarioAuthDto,
)

logger = logging.getLogger("gymos.auth")

# GW-RF-00.2 CA2: el enlace de recuperación vence en 1 h y es de un solo uso
RECUPERACION_MINUTOS = 60


class AuthService:
    """Lógica de negocio y orquestación de autenticación y permisos."""

    @staticmethod
    async def _registrar_intento_fallido(gym_id: Optional[UUID], correo: str, ip: Optional[str]) -> None:
        """
        Registra un intento fallido en una conexión independiente con su propio commit,
        garantizando que persista incluso cuando el request principal lance un error 401
        y la sesión del request haga rollback.
        Aplica SET LOCAL app.gimnasio_id para cumplir con el WITH CHECK de RLS en PostgreSQL.
        """
        async with async_session_maker() as audit_session:
            async with audit_session.begin():
                if gym_id:
                    await audit_session.execute(
                        text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
                        {"gym_id": str(gym_id)}
                    )
                await audit_session.execute(
                    text("""
                        INSERT INTO platform.intentos_login_staff (gimnasio_id, correo, ip, exito)
                        VALUES (:gym, :correo, :ip, false)
                    """),
                    {"gym": gym_id, "correo": correo, "ip": ip}
                )

    @staticmethod
    async def _seed_permisos_en_transaccion(session: AsyncSession, gym_id: UUID) -> None:
        """Siembra los permisos base dentro de la transacción activa de la sesión."""
        count_query = text("SELECT COUNT(*) FROM platform.permisos_rol WHERE gimnasio_id = :gym_id")
        res = await session.execute(count_query, {"gym_id": gym_id})
        if (res.scalar() or 0) > 0:
            return

        defaults = [
            # Rol Recepcionista
            ("recepcionista", "control_ingreso", True, True, True, False),
            ("recepcionista", "caja", True, True, False, False),
            ("recepcionista", "deportistas", True, True, True, False),
            ("recepcionista", "membresias", True, True, True, False),
            ("recepcionista", "entrenamiento", False, True, False, False),
            ("recepcionista", "clases", True, True, True, False),
            ("recepcionista", "inventario", False, True, False, False),
            ("recepcionista", "personal", False, False, False, False),
            ("recepcionista", "reportes", False, False, False, False),
            ("recepcionista", "configuracion", False, False, False, False),
            # Rol Entrenador
            ("entrenador", "control_ingreso", False, True, False, False),
            ("entrenador", "caja", False, False, False, False),
            ("entrenador", "deportistas", False, True, False, False),
            ("entrenador", "membresias", False, False, False, False),
            ("entrenador", "entrenamiento", True, True, True, True),
            ("entrenador", "clases", False, True, False, False),
            ("entrenador", "inventario", False, False, False, False),
            ("entrenador", "personal", False, False, False, False),
            ("entrenador", "reportes", False, False, False, False),
            ("entrenador", "configuracion", False, False, False, False),
        ]

        insert_stmt = text("""
            INSERT INTO platform.permisos_rol 
            (gimnasio_id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar)
            VALUES (:gym_id, :rol, :submodulo, :crear, :leer, :editar, :eliminar)
            ON CONFLICT (gimnasio_id, rol, submodulo) DO NOTHING
        """)
        for rol, sub, c, l, e, d in defaults:
            await session.execute(insert_stmt, {
                "gym_id": gym_id,
                "rol": rol,
                "submodulo": sub,
                "crear": c,
                "leer": l,
                "editar": e,
                "eliminar": d
            })

    @staticmethod
    async def obtener_lista_permisos_usuario(session: AsyncSession, gym_id: UUID, rol: str) -> List[str]:
        """
        Retorna la lista de permisos canónicos en minúsculas 'submodulo:accion'
        (leer, crear, editar, eliminar) o ['*'] para el Jefe.
        """
        if rol == "jefe":
            return ["*"]

        query = text("""
            SELECT submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar
            FROM platform.permisos_rol
            WHERE gimnasio_id = :gym_id AND rol = :rol
        """)
        res = await session.execute(query, {"gym_id": gym_id, "rol": rol})
        permisos: List[str] = []
        for row in res.mappings():
            sub = row["submodulo"]
            if row["puede_leer"]:
                permisos.append(f"{sub}:leer")
            if row["puede_crear"]:
                permisos.append(f"{sub}:crear")
            if row["puede_editar"]:
                permisos.append(f"{sub}:editar")
            if row["puede_eliminar"]:
                permisos.append(f"{sub}:eliminar")
        return permisos

    # ------------------------------------------------------------------
    # Contraseña temporal (GW-RF-00.1 CA3, GW-RF-00.5 CA1)
    # ------------------------------------------------------------------
    @staticmethod
    async def _estado_password_temporal(
        session: AsyncSession, gym_id: UUID, rol: str, debe_cambiar: bool, expira_en: Optional[datetime]
    ) -> tuple[bool, Optional[datetime]]:
        """
        Resuelve si el usuario debe cambiar la contraseña y hasta cuándo sirve la temporal.
        - Recepcionista / entrenador: columnas de platform.staff.
        - Jefe: además, la credencial que emitió el Super-Admin (cuentas_jefe.password_cambiada y la
          última emisión de 72 h), leída por el puente platform.credencial_jefe().
        """
        if rol == "jefe" and not debe_cambiar:
            res = await session.execute(
                text("SELECT password_cambiada, expira_en FROM platform.credencial_jefe(:gym_id)"),
                {"gym_id": gym_id},
            )
            row = res.mappings().first()
            if row and row["password_cambiada"] is False:
                return True, row["expira_en"]
        return debe_cambiar, expira_en if debe_cambiar else None

    @classmethod
    async def _armar_usuario(cls, session: AsyncSession, staff: dict, gym_id: UUID, subdominio: str) -> UsuarioAuthDto:
        permisos = await cls.obtener_lista_permisos_usuario(session, gym_id, staff["rol"])
        debe_cambiar, expira_en = await cls._estado_password_temporal(
            session, gym_id, staff["rol"], staff["debe_cambiar_password"], staff["password_temporal_expira_en"]
        )
        return UsuarioAuthDto(
            id=staff["id"],
            nombre=staff["nombre"],
            correo=staff["correo"],
            rol=staff["rol"],
            gimnasio_id=gym_id,
            subdominio=subdominio,
            permisos=permisos,
            debe_cambiar_password=debe_cambiar,
            password_temporal_expira_en=expira_en,
        )

    # ------------------------------------------------------------------
    # Familias de refresh tokens (GW-RF-00.1 CA1)
    # ------------------------------------------------------------------
    @staticmethod
    async def _emitir_refresh(session: AsyncSession, gym_id: UUID, staff_id: UUID, familia_id: UUID) -> str:
        raw = generate_secure_token(48)
        expira_en = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        await session.execute(
            text("""
                INSERT INTO platform.sesiones_staff (gimnasio_id, staff_id, refresh_hash, familia_id, expira_en)
                VALUES (:gym_id, :staff_id, :hash, :familia, :expira_en)
            """),
            {"gym_id": gym_id, "staff_id": staff_id, "hash": hash_token(raw), "familia": familia_id, "expira_en": expira_en},
        )
        return raw

    @staticmethod
    async def _revocar_sesiones(
        session: AsyncSession, staff_id: UUID, *, excepto_familia: Optional[UUID] = None
    ) -> None:
        """Revoca todas las sesiones del usuario (o todas menos una familia)."""
        await session.execute(
            text("""
                UPDATE platform.sesiones_staff
                   SET revocado_en = now()
                 WHERE staff_id = :staff_id AND revocado_en IS NULL
                   AND (CAST(:excepto AS uuid) IS NULL OR familia_id <> CAST(:excepto AS uuid))
            """),
            {"staff_id": staff_id, "excepto": excepto_familia},
        )

    @staticmethod
    async def _revocar_familia_y_confirmar(session: AsyncSession, gym_id: UUID, familia_id: UUID, staff_id: UUID, motivo: str) -> None:
        """
        Revoca una familia completa y CONFIRMA la transacción antes de que el request responda 401:
        get_db_session hará rollback por la excepción, pero la revocación ya quedó escrita.
        (Se hace en la misma sesión porque la fila está bloqueada con FOR UPDATE.)
        """
        await session.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym_id)})
        await session.execute(
            text("UPDATE platform.sesiones_staff SET revocado_en = now() WHERE familia_id = :f AND revocado_en IS NULL"),
            {"f": familia_id},
        )
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre="Sistema (Sesiones)",
            accion="REVOCAR_FAMILIA_REFRESH",
            entidad="sesiones_staff",
            entidad_id=str(familia_id),
            detalle={"motivo": motivo},
        )
        await session.commit()

    # ------------------------------------------------------------------
    # Login (RF-00.1, RF-00.4, GW-RF-51 CA3)
    # ------------------------------------------------------------------
    @classmethod
    async def login(cls, session: AsyncSession, data: LoginRequest, client_ip: Optional[str] = None) -> LoginResponseDto:
        # 1. Chequeo de intentos fallidos por IP ejecutado ANTES de fijar contexto de tenant
        if client_ip:
            intentos_ip = await session.execute(text("""
                SELECT COUNT(*) FROM platform.intentos_login_staff
                WHERE ip = :ip AND exito = false
                  AND created_at >= (now() - interval '15 minutes')
            """), {"ip": client_ip})
            if (intentos_ip.scalar() or 0) >= 15:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail={"codigo": "IP_BLOQUEADA_TEMPORALMENTE", "mensaje": "Demasiados intentos fallidos desde esta dirección IP. Bloqueada temporalmente por 15 minutos."}
                )

        # 2. Resolver tenant a partir del subdominio obligatorio
        res_tenant = await session.execute(
            text("SELECT id, subdominio, activo FROM platform.tenant WHERE subdominio = :subdominio"),
            {"subdominio": data.subdominio.lower()},
        )
        tenant = res_tenant.mappings().first()

        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "GIMNASIO_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado con el subdominio indicado"}
            )
        if not tenant["activo"]:
            raise gimnasio_suspendido_exception("suspendido")

        gym_id = tenant["id"]

        # 3. Gimnasio bloqueado por suscripción: no se valida contraseña (GW-RF-51 CA3)
        await verificar_suscripcion_operativa(session, gym_id)

        # 4. Establecer RLS explícito para la sesión del request
        await session.execute(
            text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
            {"gym_id": str(gym_id)}
        )

        # 5. Control de fuerza bruta por cuenta específica en este gimnasio (RF-00.4)
        intentos_cuenta = await session.execute(text("""
            SELECT COUNT(*) FROM platform.intentos_login_staff
            WHERE gimnasio_id = :gym_id AND correo = :correo AND exito = false
              AND created_at >= (now() - interval '15 minutes')
        """), {"gym_id": gym_id, "correo": data.correo})
        if (intentos_cuenta.scalar() or 0) >= 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"codigo": "CUENTA_BLOQUEADA_TEMPORALMENTE", "mensaje": "Demasiados intentos fallidos para esta cuenta. Bloqueada temporalmente por 15 minutos."}
            )

        # 6. Buscar staff filtrando estrictamente por gimnasio_id y correo
        res_staff = await session.execute(text("""
            SELECT id, gimnasio_id, nombre, correo, hash_password, rol, activo,
                   debe_cambiar_password, password_temporal_expira_en
            FROM platform.staff
            WHERE gimnasio_id = :gym_id AND correo = :correo AND deleted_at IS NULL
        """), {"gym_id": gym_id, "correo": data.correo})
        staff = res_staff.mappings().first()

        if not staff or not verify_password(data.password, staff["hash_password"]):
            await cls._registrar_intento_fallido(gym_id, data.correo, client_ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"codigo": "CREDENCIALES_INVALIDAS", "mensaje": "Correo electrónico o contraseña incorrectos"}
            )

        if not staff["activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "USUARIO_INACTIVO", "mensaje": "Su cuenta ha sido desactivada por el administrador"}
            )

        # 7. Contraseña temporal vencida (72 h): código propio, no el genérico
        debe_cambiar, expira_en = await cls._estado_password_temporal(
            session, gym_id, staff["rol"], staff["debe_cambiar_password"], staff["password_temporal_expira_en"]
        )
        if debe_cambiar and expira_en is not None and expira_en <= datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "codigo": "PASSWORD_TEMPORAL_VENCIDA",
                    "mensaje": "La contraseña temporal venció. Pide una nueva al Jefe del gimnasio o, si eres el Jefe, a MVC.",
                },
            )

        # 8. Registrar éxito y actualizar último ingreso
        await session.execute(
            text("INSERT INTO platform.intentos_login_staff (gimnasio_id, correo, ip, exito) VALUES (:gym, :correo, :ip, true)"),
            {"gym": gym_id, "correo": data.correo, "ip": client_ip}
        )
        await session.execute(
            text("UPDATE platform.staff SET ultimo_ingreso = now() WHERE id = :id"),
            {"id": staff["id"]}
        )

        # 9. Seed idempotente de permisos
        await cls._seed_permisos_en_transaccion(session, gym_id)

        # 10. Tokens: cada login abre una familia nueva de refresh
        familia_id = uuid4()
        access_token = create_access_token(
            subject=str(staff["id"]), gym_id=str(gym_id), role=staff["rol"], familia_id=str(familia_id)
        )
        raw_refresh = await cls._emitir_refresh(session, gym_id, staff["id"], familia_id)

        usuario = await cls._armar_usuario(session, dict(staff), gym_id, tenant["subdominio"])
        return LoginResponseDto(access_token=access_token, refresh_token=raw_refresh, usuario=usuario)

    # ------------------------------------------------------------------
    # Refresh con rotación por familia (GW-RF-00.1 CA1)
    # ------------------------------------------------------------------
    @classmethod
    async def refresh(cls, session: AsyncSession, data: RefreshTokenRequest) -> RefreshResponseDto:
        refresh_hash = hash_token(data.refresh_token)
        res = await session.execute(text("""
            SELECT ss.id, ss.staff_id, ss.gimnasio_id, ss.familia_id, ss.expira_en, ss.rotado_en, ss.revocado_en,
                   s.nombre, s.correo, s.rol, s.activo, s.debe_cambiar_password, s.password_temporal_expira_en,
                   t.subdominio, t.activo AS tenant_activo
            FROM platform.sesiones_staff ss
            JOIN platform.staff s ON s.id = ss.staff_id
            JOIN platform.tenant t ON t.id = ss.gimnasio_id
            WHERE ss.refresh_hash = :hash AND s.deleted_at IS NULL
            FOR UPDATE OF ss
        """), {"hash": refresh_hash})
        row = res.mappings().first()

        invalido = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"codigo": "REFRESH_TOKEN_INVALIDO", "mensaje": "Sesión inválida o expirada"}
        )
        if not row or row["revocado_en"] is not None:
            raise invalido

        # Reuso de un refresh ya rotado: alguien tiene una copia. Se revoca la familia completa.
        if row["rotado_en"] is not None:
            await cls._revocar_familia_y_confirmar(session, row["gimnasio_id"], row["familia_id"], row["staff_id"], "refresh_reutilizado")
            logger.warning("Refresh reutilizado: familia %s del staff %s revocada", row["familia_id"], row["staff_id"])
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"codigo": "REFRESH_TOKEN_REUTILIZADO", "mensaje": "La sesión fue invalidada por seguridad. Vuelve a iniciar sesión."}
            )

        if row["expira_en"] <= datetime.now(timezone.utc):
            raise invalido
        if not row["activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "USUARIO_INACTIVO", "mensaje": "Cuenta de usuario desactivada"}
            )
        if not row["tenant_activo"]:
            raise gimnasio_suspendido_exception("suspendido")

        gym_id = row["gimnasio_id"]
        await verificar_suscripcion_operativa(session, gym_id)

        await session.execute(
            text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
            {"gym_id": str(gym_id)}
        )

        # Rotar: el actual queda marcado y nace uno nuevo en la misma familia
        await session.execute(
            text("UPDATE platform.sesiones_staff SET rotado_en = now() WHERE id = :id"),
            {"id": row["id"]},
        )
        nuevo_refresh = await cls._emitir_refresh(session, gym_id, row["staff_id"], row["familia_id"])
        access_token = create_access_token(
            subject=str(row["staff_id"]), gym_id=str(gym_id), role=row["rol"], familia_id=str(row["familia_id"])
        )

        staff = {
            "id": row["staff_id"], "nombre": row["nombre"], "correo": row["correo"], "rol": row["rol"],
            "debe_cambiar_password": row["debe_cambiar_password"],
            "password_temporal_expira_en": row["password_temporal_expira_en"],
        }
        usuario = await cls._armar_usuario(session, staff, gym_id, row["subdominio"])
        return RefreshResponseDto(access_token=access_token, refresh_token=nuevo_refresh, usuario=usuario)

    # ------------------------------------------------------------------
    # Logout: revoca la familia completa (GW-RF-00.3 CA1)
    # ------------------------------------------------------------------
    @staticmethod
    async def logout(session: AsyncSession, gym_id: UUID, staff_id: UUID, refresh_token: str) -> None:
        # SET LOCAL ya fue ejecutado por get_current_staff
        await session.execute(
            text("""
                UPDATE platform.sesiones_staff
                   SET revocado_en = now()
                 WHERE revocado_en IS NULL
                   AND familia_id = (
                       SELECT familia_id FROM platform.sesiones_staff
                        WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND refresh_hash = :hash
                   )
            """),
            {"gym_id": gym_id, "staff_id": staff_id, "hash": hash_token(refresh_token)},
        )

    # ------------------------------------------------------------------
    # Recuperación de contraseña (GW-RF-00.2)
    # ------------------------------------------------------------------
    @staticmethod
    async def solicitar_recuperacion_password(session: AsyncSession, data: SolicitarRecuperacionRequest) -> None:
        """
        La respuesta es idéntica exista o no el correo, esté o no activo el usuario (CA1).
        Solo un gimnasio inexistente o bloqueado responde distinto: eso no revela nada del usuario.
        """
        tenant_res = await session.execute(
            text("SELECT id, nombre, subdominio, activo FROM platform.tenant WHERE subdominio = :subdominio"),
            {"subdominio": data.subdominio.lower()}
        )
        tenant = tenant_res.mappings().first()
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "GIMNASIO_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado"}
            )
        if not tenant["activo"]:
            raise gimnasio_suspendido_exception("suspendido")

        gym_id = tenant["id"]
        await verificar_suscripcion_operativa(session, gym_id)
        await session.execute(
            text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
            {"gym_id": str(gym_id)}
        )

        res_staff = await session.execute(
            text("""
                SELECT id, nombre, correo, activo FROM platform.staff
                WHERE gimnasio_id = :gym_id AND correo = :correo AND deleted_at IS NULL
            """),
            {"gym_id": gym_id, "correo": data.correo}
        )
        staff = res_staff.mappings().first()
        if not staff or not staff["activo"]:
            # Silencio: no se filtra la existencia ni el estado de la cuenta
            return

        # Solo sirve el último enlace: los anteriores vencen ahora
        await session.execute(
            text("""
                UPDATE platform.tokens_recuperacion_staff
                   SET expira_en = now()
                 WHERE staff_id = :staff_id AND usado_en IS NULL AND expira_en > now()
            """),
            {"staff_id": staff["id"]}
        )

        raw_token = generate_secure_token(32)
        expira_en = datetime.now(timezone.utc) + timedelta(minutes=RECUPERACION_MINUTOS)
        await session.execute(text("""
            INSERT INTO platform.tokens_recuperacion_staff (gimnasio_id, staff_id, token_hash, expira_en)
            VALUES (:gym_id, :staff_id, :token_hash, :expira_en)
        """), {"gym_id": gym_id, "staff_id": staff["id"], "token_hash": hash_token(raw_token), "expira_en": expira_en})

        # El correo sale solo si la transacción confirma; si el envío falla, se registra y ya.
        correo = correo_recuperacion_password(
            destinatario=str(staff["correo"]),
            nombre=staff["nombre"],
            gimnasio=tenant["nombre"],
            enlace=url_sistema_web(tenant["subdominio"], f"/recuperar/{raw_token}"),
            vigencia_minutos=RECUPERACION_MINUTOS,
        )

        async def enviar() -> None:
            await email_adaptador.enviar(correo)

        on_commit(session, enviar)

    @staticmethod
    async def validar_token_recuperacion(session: AsyncSession, token: str) -> bool:
        """Dice si el token sirve, sin consumirlo. No revela a quién pertenece."""
        res = await session.execute(text("""
            SELECT 1 FROM platform.tokens_recuperacion_staff t
            JOIN platform.staff s ON s.id = t.staff_id
            WHERE t.token_hash = :hash AND t.usado_en IS NULL AND t.expira_en > now()
              AND s.activo = true AND s.deleted_at IS NULL
        """), {"hash": hash_token(token)})
        return res.first() is not None

    @classmethod
    async def confirmar_recuperacion_password(cls, session: AsyncSession, data: ConfirmarRecuperacionRequest) -> None:
        t_hash = hash_token(data.token)
        res = await session.execute(text("""
            SELECT t.id, t.gimnasio_id, t.staff_id, s.rol
            FROM platform.tokens_recuperacion_staff t
            JOIN platform.staff s ON s.id = t.staff_id
            WHERE t.token_hash = :hash AND t.usado_en IS NULL AND t.expira_en > now()
              AND s.activo = true AND s.deleted_at IS NULL
            FOR UPDATE OF t
        """), {"hash": t_hash})
        row = res.mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "TOKEN_INVALIDO_O_EXPIRADO", "mensaje": "El enlace de recuperación es inválido o ha expirado"}
            )

        gym_id = row["gimnasio_id"]
        await session.execute(
            text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
            {"gym_id": str(gym_id)}
        )

        await cls._aplicar_nueva_password(session, gym_id, row["staff_id"], row["rol"], data.nueva_password)
        await session.execute(
            text("UPDATE platform.tokens_recuperacion_staff SET usado_en = now() WHERE id = :id"),
            {"id": row["id"]}
        )
        # CA3: se cierran TODAS las sesiones del usuario
        await cls._revocar_sesiones(session, row["staff_id"])

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=row["staff_id"],
            actor_nombre="Sistema (Recuperación Contraseña)",
            accion="RECUPERAR_PASSWORD",
            entidad="staff",
            entidad_id=str(row["staff_id"]),
            detalle={"metodo": "token_email"}
        )

    # ------------------------------------------------------------------
    # Cambio de contraseña con sesión (GW-RF-00.1 CA3)
    # ------------------------------------------------------------------
    @staticmethod
    async def _aplicar_nueva_password(session: AsyncSession, gym_id: UUID, staff_id: UUID, rol: str, nueva: str) -> None:
        """Guarda el hash nuevo y limpia el estado de contraseña temporal (también en el Super-Admin si es el Jefe)."""
        await session.execute(
            text("""
                UPDATE platform.staff
                   SET hash_password = :h, debe_cambiar_password = false, password_temporal_expira_en = NULL,
                       updated_at = now()
                 WHERE id = :id
            """),
            {"h": hash_password(nueva), "id": staff_id}
        )
        if rol == "jefe":
            await session.execute(text("SELECT platform.marcar_password_jefe_cambiada(:gym_id)"), {"gym_id": gym_id})

    @classmethod
    async def cambiar_password(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        rol: str,
        nombre: str,
        familia_actual: Optional[UUID],
        data: CambiarPasswordRequest,
    ) -> None:
        # SET LOCAL ya fue ejecutado por get_current_staff
        res = await session.execute(
            text("SELECT hash_password FROM platform.staff WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL"),
            {"id": staff_id, "gym_id": gym_id},
        )
        hash_actual = res.scalar()
        if not hash_actual or not verify_password(data.password_actual, hash_actual):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PASSWORD_ACTUAL_INCORRECTA", "mensaje": "La contraseña actual no es correcta"}
            )
        if data.password_nueva == data.password_actual:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PASSWORD_IGUAL_A_ACTUAL", "mensaje": "La nueva contraseña debe ser distinta de la actual"}
            )

        await cls._aplicar_nueva_password(session, gym_id, staff_id, rol, data.password_nueva)
        # Cierra las demás sesiones; la actual (familia del access token) sigue viva
        await cls._revocar_sesiones(session, staff_id, excepto_familia=familia_actual)

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=nombre,
            accion="CAMBIAR_PASSWORD",
            entidad="staff",
            entidad_id=str(staff_id),
            detalle={"sesiones_cerradas": "todas_menos_actual"}
        )

    # ------------------------------------------------------------------
    @classmethod
    async def get_me(cls, session: AsyncSession, staff_id: UUID, gym_id: UUID, rol: str, nombre: str, correo: str, subdominio: str) -> UsuarioAuthDto:
        # SET LOCAL ya fue ejecutado por get_current_staff en esta misma sesión
        res = await session.execute(
            text("SELECT debe_cambiar_password, password_temporal_expira_en FROM platform.staff WHERE id = :id"),
            {"id": staff_id},
        )
        extra = res.mappings().first() or {"debe_cambiar_password": False, "password_temporal_expira_en": None}
        staff = {"id": staff_id, "nombre": nombre, "correo": correo, "rol": rol, **dict(extra)}
        return await cls._armar_usuario(session, staff, gym_id, subdominio)

    @staticmethod
    async def obtener_matriz_permisos(session: AsyncSession, gym_id: UUID) -> List[PermisoMatrizItemDto]:
        # SET LOCAL ya fue ejecutado por get_current_staff en esta misma sesión
        query = text("""
            SELECT rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar
            FROM platform.permisos_rol
            WHERE gimnasio_id = :gym_id
            ORDER BY rol, submodulo
        """)
        res = await session.execute(query, {"gym_id": gym_id})
        return [PermisoMatrizItemDto(**dict(row)) for row in res.mappings()]

    @staticmethod
    async def actualizar_matriz_permisos(
        session: AsyncSession,
        gym_id: UUID,
        actor_id: UUID,
        actor_nombre: str,
        data: ActualizarMatrizPermisosRequest
    ) -> List[PermisoMatrizItemDto]:
        # SET LOCAL ya fue ejecutado por get_current_staff en esta misma sesión
        update_stmt = text("""
            INSERT INTO platform.permisos_rol 
            (gimnasio_id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar, updated_at)
            VALUES (:gym_id, :rol, :submodulo, :crear, :leer, :editar, :eliminar, now())
            ON CONFLICT (gimnasio_id, rol, submodulo)
            DO UPDATE SET
                puede_crear = EXCLUDED.puede_crear,
                puede_leer = EXCLUDED.puede_leer,
                puede_editar = EXCLUDED.puede_editar,
                puede_eliminar = EXCLUDED.puede_eliminar,
                updated_at = now();
        """)

        cambios = []
        for item in data.permisos:
            if item.rol == "jefe":
                continue  # El rol Jefe nunca se restringe
            await session.execute(update_stmt, {
                "gym_id": gym_id,
                "rol": item.rol,
                "submodulo": item.submodulo,
                "crear": item.puede_crear,
                "leer": item.puede_leer,
                "editar": item.puede_editar,
                "eliminar": item.puede_eliminar,
            })
            cambios.append(item.model_dump())

        # Auditoría append-only con hash-chain
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            accion="ACTUALIZAR_MATRIZ_PERMISOS",
            entidad="permisos_rol",
            entidad_id=str(gym_id),
            detalle={"cambios": cambios}
        )

        # Reconsultar matriz en la misma sesión
        query = text("""
            SELECT rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar
            FROM platform.permisos_rol
            WHERE gimnasio_id = :gym_id
            ORDER BY rol, submodulo
        """)
        res = await session.execute(query, {"gym_id": gym_id})
        return [PermisoMatrizItemDto(**dict(row)) for row in res.mappings()]
