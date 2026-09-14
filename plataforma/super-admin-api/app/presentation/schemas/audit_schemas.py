from datetime import datetime
from typing import Optional, Dict, Any, Union
from uuid import UUID
from pydantic import BaseModel, ConfigDict

class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    gimnasio_id: Optional[Union[UUID, str]] = None
    actor_id: Optional[Union[UUID, str]] = None
    actor_nombre: str
    impersonando: bool
    accion: str
    entidad: str
    entidad_id: Optional[str] = None
    detalle: Optional[Union[str, Dict[str, Any], Any]] = None
    hash_previo: Optional[str] = None
    hash_actual: str
    created_at: datetime

class AuditChainVerificationResponse(BaseModel):
    cadena_integra: bool
    total_registros_verificados: int
    primer_registro_corrupto_id: Optional[int] = None
    mensaje: str
