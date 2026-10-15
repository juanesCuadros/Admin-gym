"""
Schemas de la carga inicial de clientes (GW-RF-55, contrato 2.4).
"""
from typing import List

from pydantic import BaseModel


class ErrorFilaDto(BaseModel):
    fila: int  # número de fila tal como la ve el usuario en Excel (el encabezado es la fila 1)
    columna: str
    codigo: str
    mensaje: str


class SimulacionCargaResponse(BaseModel):
    filas_validas: int
    filas_con_error: int
    errores: List[ErrorFilaDto]


class AplicacionCargaResponse(BaseModel):
    deportistas_creados: int
    membresias_creadas: int
