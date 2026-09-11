from dataclasses import dataclass
from typing import Annotated, AsyncGenerator, Callable
from uuid import UUID
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import async_session_maker
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


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provee una sesión de base de datos limpia para el request."""
    async with async_session_maker() as session:
        yield session


async def get_current_staff(
    credentials: Annotated[HTTPAuthorizationCredentials, Security(security_bearer)],
) -> AuthenticatedStaff:
    """
    Valida el JWT de acceso y confirma que el usuario y el gimnasio permanezcan activos.
    Utiliza una sesión independiente para no alterar el estado transaccional de la sesión
    que se inyectará en el endpoint/servicio.
    """
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Tipo de token inválido",
                headers={"WWW-Authenticate": "Bearer"}
            )
        staff_id = UUID(payload["sub"])
        gym_id = UUID(payload["gym_id"])
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales de autenticación inválidas o expiradas",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # Verificación en base de datos con sesión aislada
    async with async_session_maker() as auth_session:
        query = text("""
            SELECT s.id, s.gimnasio_id, s.rol, s.correo, s.nombre, s.activo, 
                   t.subdominio, t.activo as tenant_activo
            FROM platform.staff s
            JOIN platform.tenant t ON t.id = s.gimnasio_id
            WHERE s.id = :staff_id AND s.deleted_at IS NULL
        """)
        result = await auth_session.execute(query, {"staff_id": staff_id})
        row = result.mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario no encontrado o eliminado"
            )
        if not row["activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Su cuenta ha sido desactivada por el administrador"
            )
        if not row["tenant_activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El servicio del gimnasio se encuentra suspendido"
            )

        return AuthenticatedStaff(
            id=row["id"],
            gimnasio_id=row["gimnasio_id"],
            rol=row["rol"],
            correo=row["correo"],
            nombre=row["nombre"],
            subdominio=row["subdominio"]
        )


def require_role(*allowed_roles: str) -> Callable:
    """Fábrica de dependencias para verificar que el usuario posea uno de los roles base."""
    async def role_checker(
        current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)]
    ) -> AuthenticatedStaff:
        if current_staff.rol not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso denegado. Rol requerido: {', '.join(allowed_roles)}"
            )
        return current_staff
    return role_checker


def require_permission(submodulo: str, accion: str) -> Callable:
    """
    Fábrica de dependencias que valida permisos por submódulo en tiempo real.
    - Rol 'jefe': Bypass total inmediato (nunca se valida contra permisos_rol).
    - Otros roles: Consulta platform.permisos_rol en cada request en PostgreSQL.
    Acciones canónicas: 'leer', 'crear', 'editar', 'eliminar'.
    """
    col_map = {
        "crear": "puede_crear",
        "leer": "puede_leer",
        "ver": "puede_leer",
        "editar": "puede_editar",
        "eliminar": "puede_eliminar"
    }
    columna_permiso = col_map.get(accion.lower())
    if not columna_permiso:
        raise ValueError(f"Acción de permiso desconocida: {accion}")

    async def permission_checker(
        current_staff: Annotated[AuthenticatedStaff, Depends(get_current_staff)],
    ) -> AuthenticatedStaff:
        # El Jefe siempre tiene acceso total implícito
        if current_staff.rol == "jefe":
            return current_staff

        async with async_session_maker() as perm_session:
            query = text(f"""
                SELECT {columna_permiso}
                FROM platform.permisos_rol
                WHERE gimnasio_id = :gym_id AND rol = :rol AND submodulo = :submodulo
            """)
            res = await perm_session.execute(query, {
                "gym_id": current_staff.gimnasio_id,
                "rol": current_staff.rol,
                "submodulo": submodulo.lower()
            })
            tiene_permiso = res.scalar_one_or_none()

            if not tiene_permiso:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"No tiene permisos para {accion} en el submódulo {submodulo}"
                )
            return current_staff

    return permission_checker
