from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CrearNotaRequest(BaseModel):
    texto: str = Field(..., min_length=1, max_length=2000)

    @field_validator("texto")
    @classmethod
    def no_vacia(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("La nota no puede estar vacía.")
        return v.strip()


class NotaResponse(BaseModel):
    id: str
    texto: str
    autor_nombre: Optional[str] = None
    created_at: datetime
