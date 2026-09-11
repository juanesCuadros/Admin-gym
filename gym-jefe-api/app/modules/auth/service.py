import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.database import async_session_maker
from app.core.security import (
    create_access_token,
    generate_secure_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.modules.auth.schemas import (
    ActualizarMatrizPermisosRequest,
    ConfirmarRecuperacionRequest,
    LoginRequest,
    LoginResponseDto,
    PermisoMatrizItemDto,
    RefreshResponseDto,
    RefreshTokenRequest,
    SolicitarRecuperacionRequest,
    UsuarioAuthDto,
)


class AuthService:
    """Lógica de negocio y orquestación de autenticación y permisos."""

    @staticmethod
    async def _registrar_intento_fallido(gym_id: Optional[UUID], correo: str, ip: Optional[str]) -> None:
        """
        Registra un intento fallido en una transacción aislada para que persista
        incluso cuando el request principal lance un error 401.
        """
        async with async_session_maker() as audit_session:
            async with audit_session.begin():
                await audit_session.execute(
                    text("""
                        INSERT INTO platform.intentos_login_staff (gimnasio_id, correo, ip, exito)
                        VALUES (:gym, :correo, :ip, false)
                    """),
                    {"gym": gym_id, "correo": correo, "ip": ip}
                )

    @staticmethod
    async def _seed_permisos_en_transaccion(session: AsyncSession, gym_id: UUID) -> None:
        """Siembra los permisos base dentro de la transacción activa (sin commit propio)."""
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

    @classmethod
    async def login(cls, session: AsyncSession, data: LoginRequest, client_ip: Optional[str] = None) -> LoginResponseDto:
        async with session.begin():
            # 1. Resolver tenant a partir del subdominio obligatorio
            tenant_query = text("""
                SELECT id, subdominio, activo 
                FROM platform.tenant 
                WHERE subdominio = :subdominio
            """)
            res_tenant = await session.execute(tenant_query, {"subdominio": data.subdominio.lower()})
            tenant = res_tenant.mappings().first()

            if not tenant:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "GIMNASIO_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado con el subdominio indicado"}
                )

            if not tenant["activo"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"codigo": "GIMNASIO_SUSPENDIDO", "mensaje": "El servicio del gimnasio se encuentra suspendido"}
                )

            gym_id = tenant["id"]

            # 2. Establecer RLS explícito para la transacción
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )

            # 3. Control de fuerza bruta por cuenta y por IP (RF-00.4)
            # A) Por cuenta en este gimnasio (5 fallos en 15 min)
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

            # B) Por IP para mitigar credential-stuffing (15 fallos en 15 min)
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

            # 4. Buscar staff filtrando estrictamente por gimnasio_id y correo
            staff_query = text("""
                SELECT id, gimnasio_id, nombre, correo, hash_password, rol, activo
                FROM platform.staff
                WHERE gimnasio_id = :gym_id AND correo = :correo AND deleted_at IS NULL
            """)
            res_staff = await session.execute(staff_query, {"gym_id": gym_id, "correo": data.correo})
            staff = res_staff.mappings().first()

            if not staff or not verify_password(data.password, staff["hash_password"]):
                # Registrar intento fallido persistente en sesión independiente antes de lanzar 401
                await cls._registrar_intento_fallido(gym_id, data.correo, client_ip)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"codigo": "CREDENCIALES_INVALIDAS", "mensaje": "Correo electrónico o contraseña incorrectos"}
                )

            # 5. Validar si la cuenta está activa
            if not staff["activo"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"codigo": "USUARIO_INACTIVO", "mensaje": "Su cuenta ha sido desactivada por el administrador"}
                )

            # 6. Registrar éxito y actualizar último ingreso
            await session.execute(
                text("INSERT INTO platform.intentos_login_staff (gimnasio_id, correo, ip, exito) VALUES (:gym, :correo, :ip, true)"),
                {"gym": gym_id, "correo": data.correo, "ip": client_ip}
            )
            await session.execute(
                text("UPDATE platform.staff SET ultimo_ingreso = now() WHERE id = :id"),
                {"id": staff["id"]}
            )

            # 7. Seed idempotente dentro de la misma transacción
            await cls._seed_permisos_en_transaccion(session, gym_id)

            # 8. Generar Tokens
            access_token = create_access_token(
                subject=str(staff["id"]),
                gym_id=str(gym_id),
                role=staff["rol"]
            )
            raw_refresh = generate_secure_token(48)
            refresh_hash = hash_token(raw_refresh)
            expira_en = datetime.now(timezone.utc) + timedelta(days=7)

            await session.execute(text("""
                INSERT INTO platform.sesiones_staff (gimnasio_id, staff_id, refresh_hash, expira_en)
                VALUES (:gym_id, :staff_id, :refresh_hash, :expira_en)
            """), {
                "gym_id": gym_id,
                "staff_id": staff["id"],
                "refresh_hash": refresh_hash,
                "expira_en": expira_en
            })

            # 9. Resolver lista canónica de permisos
            permisos = await cls.obtener_lista_permisos_usuario(session, gym_id, staff["rol"])

            return LoginResponseDto(
                access_token=access_token,
                refresh_token=raw_refresh,
                usuario=UsuarioAuthDto(
                    id=staff["id"],
                    nombre=staff["nombre"],
                    correo=staff["correo"],
                    rol=staff["rol"],
                    gimnasio_id=gym_id,
                    subdominio=tenant["subdominio"],
                    permisos=permisos
                )
            )

    @classmethod
    async def refresh(cls, session: AsyncSession, data: RefreshTokenRequest) -> RefreshResponseDto:
        async with session.begin():
            refresh_hash = hash_token(data.refresh_token)
            query = text("""
                SELECT ss.id, ss.staff_id, ss.gimnasio_id, s.nombre, s.correo, s.rol, s.activo, 
                       t.subdominio, t.activo as tenant_activo
                FROM platform.sesiones_staff ss
                JOIN platform.staff s ON s.id = ss.staff_id
                JOIN platform.tenant t ON t.id = ss.gimnasio_id
                WHERE ss.refresh_hash = :hash AND ss.expira_en > now() AND s.deleted_at IS NULL
            """)
            res = await session.execute(query, {"hash": refresh_hash})
            row = res.mappings().first()

            if not row:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={"codigo": "REFRESH_TOKEN_INVALIDO", "mensaje": "Sesión inválida o expirada"}
                )
            if not row["activo"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"codigo": "USUARIO_INACTIVO", "mensaje": "Cuenta de usuario desactivada"}
                )
            if not row["tenant_activo"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"codigo": "GIMNASIO_SUSPENDIDO", "mensaje": "El servicio del gimnasio se encuentra suspendido"}
                )

            # RLS en la transacción
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(row["gimnasio_id"])}
            )

            access_token = create_access_token(
                subject=str(row["staff_id"]),
                gym_id=str(row["gimnasio_id"]),
                role=row["rol"]
            )
            permisos = await cls.obtener_lista_permisos_usuario(session, row["gimnasio_id"], row["rol"])

            return RefreshResponseDto(
                access_token=access_token,
                usuario=UsuarioAuthDto(
                    id=row["staff_id"],
                    nombre=row["nombre"],
                    correo=row["correo"],
                    rol=row["rol"],
                    gimnasio_id=row["gimnasio_id"],
                    subdominio=row["subdominio"],
                    permisos=permisos
                )
            )

    @staticmethod
    async def logout(session: AsyncSession, gym_id: UUID, refresh_token: str) -> None:
        async with session.begin():
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )
            r_hash = hash_token(refresh_token)
            await session.execute(
                text("DELETE FROM platform.sesiones_staff WHERE gimnasio_id = :gym_id AND refresh_hash = :hash"),
                {"gym_id": gym_id, "hash": r_hash}
            )

    @staticmethod
    async def solicitar_recuperacion_password(session: AsyncSession, data: SolicitarRecuperacionRequest) -> None:
        async with session.begin():
            # 1. Resolver tenant
            tenant_res = await session.execute(
                text("SELECT id FROM platform.tenant WHERE subdominio = :subdominio AND activo = true"),
                {"subdominio": data.subdominio.lower()}
            )
            tenant = tenant_res.mappings().first()
            if not tenant:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "GIMNASIO_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado"}
                )

            gym_id = tenant["id"]
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )

            # 2. Buscar staff
            res_staff = await session.execute(
                text("SELECT id FROM platform.staff WHERE gimnasio_id = :gym_id AND correo = :correo AND deleted_at IS NULL"),
                {"gym_id": gym_id, "correo": data.correo}
            )
            staff = res_staff.mappings().first()
            if not staff:
                # Retorna silenciosamente para no filtrar existencia de correos
                return

            raw_token = generate_secure_token(32)
            t_hash = hash_token(raw_token)
            expira_en = datetime.now(timezone.utc) + timedelta(hours=2)

            await session.execute(text("""
                INSERT INTO platform.tokens_recuperacion_staff (gimnasio_id, staff_id, token_hash, expira_en)
                VALUES (:gym_id, :staff_id, :token_hash, :expira_en)
            """), {
                "gym_id": gym_id,
                "staff_id": staff["id"],
                "token_hash": t_hash,
                "expira_en": expira_en
            })

    @staticmethod
    async def confirmar_recuperacion_password(session: AsyncSession, data: ConfirmarRecuperacionRequest) -> None:
        async with session.begin():
            t_hash = hash_token(data.token)
            res = await session.execute(text("""
                SELECT id, gimnasio_id, staff_id FROM platform.tokens_recuperacion_staff
                WHERE token_hash = :hash AND usado_en IS NULL AND expira_en > now()
            """), {"hash": t_hash})
            row = res.mappings().first()

            if not row:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "TOKEN_INVALIDO_O_EXPIRADO", "mensaje": "El enlace de recuperación es inválido o ha expirado"}
                )

            gym_id = row["gimnasio_id"]
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )

            nuevo_hash = hash_password(data.nueva_password)

            # Actualizar contraseña
            await session.execute(
                text("UPDATE platform.staff SET hash_password = :h, updated_at = now() WHERE id = :id"),
                {"h": nuevo_hash, "id": row["staff_id"]}
            )
            # Marcar token usado
            await session.execute(
                text("UPDATE platform.tokens_recuperacion_staff SET usado_en = now() WHERE id = :id"),
                {"id": row["id"]}
            )
            # Revocar todas las sesiones del usuario
            await session.execute(
                text("DELETE FROM platform.sesiones_staff WHERE staff_id = :staff_id"),
                {"staff_id": row["staff_id"]}
            )
            # Auditoría append-only
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

    @classmethod
    async def get_me(cls, session: AsyncSession, staff_id: UUID, gym_id: UUID, rol: str, nombre: str, correo: str, subdominio: str) -> UsuarioAuthDto:
        async with session.begin():
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )
            permisos = await cls.obtener_lista_permisos_usuario(session, gym_id, rol)
            return UsuarioAuthDto(
                id=staff_id,
                nombre=nombre,
                correo=correo,
                rol=rol,
                gimnasio_id=gym_id,
                subdominio=subdominio,
                permisos=permisos
            )

    @staticmethod
    async def obtener_matriz_permisos(session: AsyncSession, gym_id: UUID) -> List[PermisoMatrizItemDto]:
        async with session.begin():
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )
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
        async with session.begin():
            await session.execute(
                text("SET LOCAL app.gimnasio_id = :gym_id"),
                {"gym_id": str(gym_id)}
            )

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

            # Reconsultar matriz en la misma transacción
            query = text("""
                SELECT rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar
                FROM platform.permisos_rol
                WHERE gimnasio_id = :gym_id
                ORDER BY rol, submodulo
            """)
            res = await session.execute(query, {"gym_id": gym_id})
            return [PermisoMatrizItemDto(**dict(row)) for row in res.mappings()]
