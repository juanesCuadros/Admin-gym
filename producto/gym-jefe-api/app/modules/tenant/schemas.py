from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class TenantThemeResponse(BaseModel):
    tenant_id: UUID = Field(..., description="Identificador único del gimnasio (UUID)")
    gym_name: str = Field(..., description="Nombre oficial del gimnasio")
    logo_url: Optional[str] = Field(None, description="URL del logotipo vectorial o imagen en Cloud Storage")
    primary_color: str = Field("#FF5722", description="Color primario en formato HEX")
    secondary_color: str = Field("#1A1A1A", description="Color secundario en formato HEX")
    accent_color: str = Field("#00E676", description="Color de acento para botones y métricas")
    subdominio: str = Field(..., description="Subdominio del gimnasio")
    app_movil_activa: bool = Field(True, description="Indica si el gimnasio tiene activo el servicio de App Móvil")


class ResolverTenantRequest(BaseModel):
    correo: EmailStr = Field(..., description="Correo del deportista o personal")


class ResolverTenantResponse(BaseModel):
    tenant_id: UUID = Field(..., description="Identificador único del gimnasio")
    gym_name: str = Field(..., description="Nombre oficial del gimnasio")
    logo_url: Optional[str] = Field(None, description="URL del logotipo vectorial o imagen")
    primary_color: str = Field("#FF5722", description="Color primario en formato HEX")
    secondary_color: str = Field("#1A1A1A", description="Color secundario en formato HEX")
    accent_color: str = Field("#00E676", description="Color de acento")
    subdominio: str = Field(..., description="Subdominio del gimnasio")
    app_movil_activa: bool = Field(True, description="Estado del add-on de App Móvil para este gimnasio")
    usuario_existe: bool = Field(True, description="Indica si existe una ficha o cuenta para este correo")
    requiere_activacion: bool = Field(False, description="True si es la primera vez que ingresa y debe validar PIN")
