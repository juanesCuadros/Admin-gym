from math import ceil
from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1, description="Número de página (1-indexada)")
    limit: int = Field(default=20, ge=1, le=100, description="Cantidad de registros por página")
    q: Optional[str] = Field(default=None, description="Término de búsqueda por nombre o documento")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit


class PaginationMeta(BaseModel):
    total_registros: int
    pagina_actual: int
    total_paginas: int
    limite: int


class PaginatedData(BaseModel, Generic[T]):
    items: List[T]
    paginacion: PaginationMeta


class PaginatedResponse(BaseModel, Generic[T]):
    success: bool = True
    data: PaginatedData[T]

    @classmethod
    def create(cls, items: List[T], total: int, params: PaginationParams):
        total_paginas = ceil(total / params.limit) if total > 0 else 1
        return cls(
            success=True,
            data=PaginatedData(
                items=items,
                paginacion=PaginationMeta(
                    total_registros=total,
                    pagina_actual=params.page,
                    total_paginas=total_paginas,
                    limite=params.limit
                )
            )
        )
