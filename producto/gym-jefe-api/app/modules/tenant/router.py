from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.security import decode_access_token
from app.modules.tenant.schemas import (
    ResolverTenantRequest,
    ResolverTenantResponse,
    TenantThemeResponse,
)
from app.modules.tenant.service import TenantService

router = APIRouter(prefix="/tenant", tags=["00. Arquitectura Multi-Tenant"])

optional_bearer = HTTPBearer(auto_error=False)


@router.post(
    "/resolver-correo",
    response_model=ResolverTenantResponse,
    summary="4.1 Pre-registro: Resolver gimnasio por correo y obtener identidad visual",
)
async def resolver_correo_tenant(
    data: ResolverTenantRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
):
    return await TenantService.resolver_por_correo(session, data.correo)


@router.get(
    "/config/theme",
    response_model=TenantThemeResponse,
    summary="4.3 Dynamic White-Labeling: Obtener configuración de marca del gimnasio",
)
async def get_tenant_theme(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(optional_bearer)] = None,
    x_tenant_id: Annotated[Optional[str], Header(alias="X-Tenant-Id")] = None,
):
    """
    Retorna la paleta de colores y logotipo del tenant.
    El tenant_id se extrae prioritariamente del token JWT verificado (Sección 4.2),
    o alternativamente del header X-Tenant-Id para vistas previas en cliente.
    """
    gym_id: Optional[UUID] = None

    if credentials and credentials.credentials:
        try:
            payload = decode_access_token(credentials.credentials)
            token_gym = payload.get("tenant_id") or payload.get("gym_id")
            if token_gym:
                gym_id = UUID(str(token_gym))
        except Exception:
            pass

    if not gym_id and x_tenant_id:
        try:
            gym_id = UUID(x_tenant_id.strip())
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "TENANT_ID_INVALIDO", "mensaje": "Header X-Tenant-Id debe ser un UUID válido"},
            )

    if not gym_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"codigo": "TENANT_NO_IDENTIFICADO", "mensaje": "Se requiere autenticación Bearer JWT o header X-Tenant-Id"},
        )

    return await TenantService.obtener_tema(session, gym_id)
