from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field

EstadoEstacion = Literal["por_activar", "codigo_vencido", "activa", "revocada"]


# --- Estaciones (las administra el Jefe) ---
class CrearEstacionRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=60, description="Nombre para reconocer el equipo, p. ej. 'Recepción principal'")


class RevocarEstacionRequest(BaseModel):
    motivo: str = Field(..., min_length=4, max_length=255, description="Motivo obligatorio de la revocación")


class EstacionDto(BaseModel):
    id: UUID
    nombre: str
    estado: EstadoEstacion
    codigo_expira_en: Optional[datetime] = None
    activada_en: Optional[datetime] = None
    nombre_equipo: Optional[str] = None
    version_app: Optional[str] = None
    ultima_sync_en: Optional[datetime] = None
    revocada_en: Optional[datetime] = None
    motivo_revocacion: Optional[str] = None
    creada_por_nombre: Optional[str] = None
    created_at: datetime


class EstacionConCodigoDto(EstacionDto):
    """El código de activación viaja una sola vez: al crear la estación o al regenerarlo."""
    codigo: str
