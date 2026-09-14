from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class AvisoPantallaItem(BaseModel):
    id: str = Field(..., description="Identificador único del aviso")
    titulo: str = Field(..., min_length=2, max_length=100, description="Título del aviso")
    contenido: str = Field(..., min_length=2, max_length=500, description="Cuerpo del mensaje o anuncio")
    activo: bool = Field(True, description="Si el aviso se muestra actualmente en rotación")
    orden: int = Field(1, ge=1, description="Orden de prioridad en el carrusel")


class PantallaConfigDto(BaseModel):
    logo_url: Optional[str] = Field(None, description="URL pública del logo para el encabezado del televisor")
    tiempo_saludo_segundos: int = Field(8, ge=3, le=30, description="Duración de la pantalla de bienvenida antes de volver al reposo")
    mostrar_clases: bool = Field(True, description="Muestra la lista de clases programadas para hoy")
    mostrar_avisos: bool = Field(True, description="Muestra el carrusel de avisos institucionales")
    avisos: List[AvisoPantallaItem] = Field(default_factory=list, description="Lista de avisos configurados")


class ActualizarPantallaConfigRequest(BaseModel):
    logo_url: Optional[str] = Field(None, description="URL pública del logo")
    tiempo_saludo_segundos: Optional[int] = Field(None, ge=3, le=30, description="Segundos de visualización del saludo")
    mostrar_clases: Optional[bool] = Field(None, description="Habilitar/deshabilitar bloque de clases")
    mostrar_avisos: Optional[bool] = Field(None, description="Habilitar/deshabilitar carrusel de avisos")
    avisos: Optional[List[AvisoPantallaItem]] = Field(None, description="Reemplazo completo de la lista de avisos")


class RegenerarDeviceTokenResponse(BaseModel):
    device_token: str = Field(..., description="Token de dispositivo en texto plano. Guárdelo en un lugar seguro; no se volverá a mostrar.")
    mensaje: str = Field(..., description="Instrucciones de configuración en el televisor")


class ClaseItemTvDto(BaseModel):
    id: UUID
    nombre: str
    hora: str  # Ej: '07:00 AM'
    entrenador_nombre: Optional[str] = None
    cupos_disponibles: int


class DisplayDataResponse(BaseModel):
    gimnasio_id: UUID
    gimnasio_nombre: str
    subdominio: str
    hora_local: datetime
    configuracion: PantallaConfigDto
    clases_hoy: List[ClaseItemTvDto]


class TestSaludoRequest(BaseModel):
    nombre: str = Field("Deportista de Prueba", min_length=2, max_length=100)
    estado: str = Field("activo", description="activo, por_vencer, mora, etc.")
    dias_restantes: int = Field(15, ge=0)
    mensaje: Optional[str] = Field(None, description="Mensaje opcional de bienvenida")
