from dataclasses import dataclass
from typing import Annotated, Callable, Optional
from uuid import UUID
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db_session
from app.core.security import decode_access_token

security_bearer = HTTPBearer(auto_error=True)


@dataclass
class AuthenticatedStaff:
    id: UUID
    gimnasio_id: UUID
    rol: str
    correo: str
    nombre: str
    subdominio: str
    # Familia de refresh tokens del login con el que se emitió el access token (claim `fam`)
    familia_id: Optional[UUID] = None

    @property
    def staff_id(self) -> UUID:
        return self.id


@dataclass
class AuthenticatedDeportista:
    cuenta_id: UUID
    deportista_id: UUID
    gimnasio_id: UUID
    correo: str
    nombre: str
    documento: str
    subdominio: str
    gimnasio_nombre: str

    @property
    def id(self) -> UUID:
        return self.deportista_id


def gimnasio_suspendido_exception(motivo: Optional[str] = None) -> HTTPException:
    """403 único para todo bloqueo del gimnasio; el motivo es genérico, nunca datos internos."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "codigo": "GIMNASIO_SUSPENDIDO",
            "mensaje": "El servicio del gimnasio no está disponible",
            "detalles": {"motivo": motivo or "suspendido"},
        },
    )


async def verificar_suscripcion_operativa(session: AsyncSession, gym_id: UUID) -> None:
    """
    GW-RF-51 CA3 / SA-RF-32: si el estado calculado de la suscripción es `bloqueado`
    (falta de pago, suspendido, cancelado o prueba vencida), la API responde 403 a toda operación.
    Se calcula en cada consulta vía platform.estado_suscripcion(); sin procesos programados.
    """
    res = await session.execute(
        text("SELECT estado_calculado, motivo_bloqueo FROM platform.estado_suscripcion(:gym_id)"),
        {"gym_id": gym_id},
    )
    row = res.mappings().first()
    if row and row["estado_calculado"] == "bloqueado":
        raise gimnasio_suspendido_exception(row["motivo_bloqueo"])


async def get_current_staff(
    credentials: Annotated[HTTPAuthorizationCredentials, Security(security_bearer)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthenticatedStaff:
    """
    Valida el JWT de acceso, fija SET LOCAL app.gimnasio_id para la sesión
    y confirma que el usuario y el gimnasio permanezcan activos.
    """
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        if payload.get("rol") == "deportista" or payload.get("type") == "portal_access":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "ROL_NO_AUTORIZADO", "mensaje": "Acceso exclusivo para personal administrativo del gimnasio"},
            )
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"codigo": "TOKEN_INVALIDO", "mensaje": "Tu sesión no es válida. Vuelve a iniciar sesión."},
                headers={"WWW-Authenticate": "Bearer"}
            )
        staff_id = UUID(payload["sub"])
        gym_id = UUID(payload["gym_id"])
        familia_id = UUID(payload["fam"]) if payload.get("fam") else None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"codigo": "TOKEN_INVALIDO", "mensaje": "Credenciales de autenticación inválidas o expiradas"},
            headers={"WWW-Authenticate": "Bearer"}
        )

    # 1. Establecer RLS para toda la transacción del request (Sección 4.2: app.current_tenant_id)
    await session.execute(
        text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
        {"gym_id": str(gym_id)}
    )
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :gym_id, true)"),
        {"gym_id": str(gym_id)}
    )

    # 2. Consultar existencia y estado del usuario y tenant
    query = text("""
        SELECT s.id, s.gimnasio_id, s.rol, s.correo, s.nombre, s.activo, 
               t.subdominio, t.activo as tenant_activo
        FROM platform.staff s
        JOIN platform.tenant t ON t.id = s.gimnasio_id
        WHERE s.id = :staff_id AND s.deleted_at IS NULL
    """)
    result = await session.execute(query, {"staff_id": staff_id})
    row = result.mappings().first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"codigo": "USUARIO_NO_ENCONTRADO", "mensaje": "Usuario no encontrado o eliminado"}
        )
    if not row["activo"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"codigo": "USUARIO_INACTIVO", "mensaje": "Su cuenta ha sido desactivada por el administrador"}
        )
    if not row["tenant_activo"]:
        raise gimnasio_suspendido_exception("suspendido")

    # Bloqueo automático por suscripción vencida (calculado, sin procesos programados)
    await verificar_suscripcion_operativa(session, row["gimnasio_id"])

    return AuthenticatedStaff(
        id=row["id"],
        gimnasio_id=row["gimnasio_id"],
        rol=row["rol"],
        correo=row["correo"],
        nombre=row["nombre"],
        subdominio=row["subdominio"],
        familia_id=familia_id,
    )


def require_role(*allowed_roles: str) -> Callable:
    """Fábrica de dependencias para verificar que el usuario posea uno de los roles base."""
    async def role_checker(
        current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)]
    ) -> AuthenticatedStaff:
        if current_staff.rol not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "ROL_NO_AUTORIZADO", "mensaje": "Tu rol no tiene acceso a esta opción."}
            )
        return current_staff
    return role_checker


_COLUMNA_PERMISO = {
    "crear": "puede_crear",
    "leer": "puede_leer",
    "ver": "puede_leer",
    "editar": "puede_editar",
    "eliminar": "puede_eliminar"
}


def require_permission(submodulo: str, accion: str) -> Callable:
    """
    Fábrica de dependencias que valida permisos por submódulo en tiempo real
    utilizando la misma sesión inyectada.
    - Rol 'jefe': Bypass total inmediato (nunca se valida contra permisos_rol).
    - Otros roles: Consulta platform.permisos_rol en cada request en PostgreSQL.
    Acciones canónicas: 'leer', 'crear', 'editar', 'eliminar'.
    """
    if accion.lower() not in _COLUMNA_PERMISO:
        raise ValueError(f"Acción de permiso desconocida: {accion}")

    async def permission_checker(
        current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
        session: Annotated[AsyncSession, Depends(get_db_session)],
    ) -> AuthenticatedStaff:
        await exigir_permiso(session, current_staff, submodulo, accion)
        return current_staff

    return permission_checker


async def staff_tiene_permiso(session: AsyncSession, staff: AuthenticatedStaff, submodulo: str, accion: str) -> bool:
    """Permiso del rol en platform.permisos_rol. El Jefe lo tiene todo; sin fila de permiso, no (fail-closed)."""
    if staff.rol == "jefe":
        return True
    columna_permiso = _COLUMNA_PERMISO.get(accion.lower())
    if not columna_permiso:
        raise ValueError(f"Acción de permiso desconocida: {accion}")
    res = await session.execute(text(f"""
        SELECT {columna_permiso}
        FROM platform.permisos_rol
        WHERE gimnasio_id = :gym_id AND rol = :rol AND submodulo = :submodulo
    """), {"gym_id": staff.gimnasio_id, "rol": staff.rol, "submodulo": submodulo.lower()})
    return bool(res.scalar_one_or_none())


async def exigir_permiso(session: AsyncSession, staff: AuthenticatedStaff, submodulo: str, accion: str) -> None:
    """Igual que `require_permission`, para cuando el permiso depende del contenido de la petición."""
    if not await staff_tiene_permiso(session, staff, submodulo, accion):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "codigo": "PERMISO_DENEGADO",
                "mensaje": "No tienes permiso para hacer esta acción. Pídeselo al Jefe del gimnasio.",
                "detalles": {"submodulo": submodulo, "accion": accion},
            }
        )


async def get_current_deportista(
    credentials: Annotated[HTTPAuthorizationCredentials, Security(security_bearer)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthenticatedDeportista:
    """
    Valida el JWT de acceso exclusivo del Portal del Deportista (`type = 'portal_access'`),
    fija SET LOCAL app.gimnasio_id para RLS y verifica que la cuenta del deportista,
    la ficha del deportista y el gimnasio estén activos.
    Garantiza aislamiento anti-IDOR: el deportista_id sale únicamente del token verificado.
    """
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        if payload.get("type") != "portal_access" or payload.get("rol") != "deportista":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"codigo": "TOKEN_INVALIDO", "mensaje": "Token de deportista inválido"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        deportista_id = UUID(payload.get("user_id") or payload["sub"])
        cuenta_id = UUID(payload["cuenta_id"])
        gym_id = UUID(payload.get("tenant_id") or payload["gym_id"])
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"codigo": "TOKEN_INVALIDO", "mensaje": "Sesión de deportista inválida o expirada"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Fijar RLS en PostgreSQL para toda la transacción (Sección 4.2)
    await session.execute(
        text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
        {"gym_id": str(gym_id)},
    )
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :gym_id, true)"),
        {"gym_id": str(gym_id)},
    )

    # 2. Verificar cuenta_app + deportista + tenant
    query = text("""
        SELECT ca.id AS cuenta_id, ca.activa AS cuenta_activa, ca.correo,
               d.id AS deportista_id, d.gimnasio_id, d.nombre, d.documento, d.activo AS deportista_activo,
               t.subdominio, t.nombre AS gimnasio_nombre, t.activo AS tenant_activo
        FROM platform.cuentas_app ca
        JOIN platform.deportistas d ON d.id = ca.deportista_id
        JOIN platform.tenant t ON t.id = ca.gimnasio_id
        WHERE ca.id = :cuenta_id
          AND ca.deportista_id = :deportista_id
          AND ca.gimnasio_id = :gym_id
          AND d.deleted_at IS NULL
    """)
    res = await session.execute(
        query,
        {
            "cuenta_id": cuenta_id,
            "deportista_id": deportista_id,
            "gym_id": gym_id,
        },
    )
    row = res.mappings().first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"codigo": "USUARIO_NO_ENCONTRADO", "mensaje": "Cuenta de deportista no encontrada"},
        )
    if not row["cuenta_activa"] or not row["deportista_activo"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"codigo": "USUARIO_INACTIVO", "mensaje": "Tu cuenta de deportista se encuentra inactiva"},
        )
    if not row["tenant_activo"]:
        raise gimnasio_suspendido_exception("suspendido")

    await verificar_suscripcion_operativa(session, row["gimnasio_id"])

    return AuthenticatedDeportista(
        cuenta_id=row["cuenta_id"],
        deportista_id=row["deportista_id"],
        gimnasio_id=row["gimnasio_id"],
        correo=str(row["correo"]),
        nombre=row["nombre"],
        documento=row["documento"],
        subdominio=row["subdominio"],
        gimnasio_nombre=row["gimnasio_nombre"],
    )
