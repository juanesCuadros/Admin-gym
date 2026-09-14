from typing import Optional
import uuid
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db, set_tenant_rls_context
from app.infrastructure.models.superadmin_models import UsuarioInterno, TokenInvalido
from app.core.security import decode_access_token, compute_sha256_hash
from app.core.exceptions import AuthenticationFailedException, ForbiddenException

# Standard HTTP Bearer Token security for OpenAPI / Swagger UI
security_bearer = HTTPBearer(auto_error=True)

def get_current_admin_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_bearer),
    db: Session = Depends(get_db)
) -> UsuarioInterno:
    """
    Validates JWT access token, verifies token is not revoked (RF-00.3),
    and strictly enforces that user is an active internal MVC operator with superadmin/admin role.
    """
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
        token_role: str = payload.get("role", "")
        token_type: str = payload.get("type", "")

        if user_id is None:
            raise AuthenticationFailedException("Token inválido: identificador de sujeto ausente.")
        if token_type != "access_token":
            raise AuthenticationFailedException("Tipo de token inválido para esta operación.")
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesión ha expirado por inactividad. Por favor inicie sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acceso inválido o corrupto.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Check if token has been revoked via logout (RF-00.3)
    token_hash = compute_sha256_hash(token)
    revoked = db.query(TokenInvalido).filter(TokenInvalido.token_hash == token_hash).first()
    if revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token de acceso ha sido revocado (sesión cerrada). Por favor inicie sesión nuevamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Query internal MVC operator
    user = db.query(UsuarioInterno).filter(
        UsuarioInterno.id == user_id,
        UsuarioInterno.deleted_at.is_(None)
    ).first()

    if not user:
        raise AuthenticationFailedException("Usuario no encontrado.")
    if not user.activo:
        raise ForbiddenException("Usuario inactivo o suspendido.")

    # 3. Strict role validation: Tenant users (jefe, entrenador, recepcionista) cannot access Super Admin
    if user.rol not in ["superadmin", "admin"] or token_role not in ["superadmin", "admin"]:
        raise ForbiddenException("Acceso denegado: se requieren privilegios de Super Administrador.")

    return user

def get_optional_tenant_context(request: Request, db: Session = Depends(get_db)) -> Optional[str]:
    """
    Extracts optional tenant_id header from request and sets RLS context if present.
    Validates UUID format to avoid injection or tampering.
    """
    tenant_id = request.headers.get("X-Tenant-Id")
    if tenant_id:
        try:
            uuid.UUID(tenant_id)
        except (ValueError, AttributeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Identificador X-Tenant-Id inválido: formato UUID requerido."
            )
        set_tenant_rls_context(db, tenant_id)
    return tenant_id

