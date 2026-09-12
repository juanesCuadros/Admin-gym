"""
Esquemas Pydantic y DTOs para el Módulo 6: Entrenamiento (RF-28 a RF-31).
Cubre catálogo híbrido de ejercicios, plantillas de rutina reutilizables,
y rutinas asignadas a deportistas como snapshots inmutables.
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict


# =============================================================================
# 1. ESQUEMAS PARA CATÁLOGO DE EJERCICIOS (RF-28)
# =============================================================================

class EjercicioBase(BaseModel):
    nombre_es: str = Field(..., min_length=2, max_length=150, description="Nombre del ejercicio en español")
    nombre_en: Optional[str] = Field(None, max_length=150, description="Nombre opcional en inglés")
    instrucciones: Optional[str] = Field(None, description="Instrucciones técnicas de ejecución")
    grupo_muscular: Optional[str] = Field(None, max_length=80, description="Ej: Pecho, Espalda, Piernas, Core, etc.")
    equipo: Optional[str] = Field(None, max_length=80, description="Ej: Mancuernas, Barra, Polea, Peso corporal, etc.")
    categoria: Optional[str] = Field(None, max_length=80, description="Ej: Fuerza, Hipertrofia, Cardio, Movilidad")
    archivo_url: Optional[str] = Field(None, description="URL del recurso multimedia o animación GIF ilustrativa")


class CrearEjercicioPropioRequest(EjercicioBase):
    pass


class EditarEjercicioPropioRequest(EjercicioBase):
    version: int = Field(..., description="Versión actual esperada para control de concurrencia optimista")


class CambiarEstadoEjercicioRequest(BaseModel):
    activo: bool = Field(..., description="True para activar en la sede, False para desactivar")


class EjercicioResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: Optional[UUID] = None
    propio: bool
    nombre_es: str
    nombre_en: Optional[str] = None
    instrucciones: Optional[str] = None
    grupo_muscular: Optional[str] = None
    equipo: Optional[str] = None
    categoria: Optional[str] = None
    archivo_url: Optional[str] = None
    activo_en_gym: bool
    version: int
    created_at: datetime
    updated_at: datetime


class EjerciciosPaginadosResponse(BaseModel):
    items: List[EjercicioResponse]
    total: int
    skip: int
    limit: int


# =============================================================================
# 2. ESQUEMAS PARA ITEMS DE RUTINA Y PLANTILLAS (RF-29)
# =============================================================================

class RutinaItemInput(BaseModel):
    ejercicio_id: UUID
    orden: int = Field(0, description="Secuencia u orden numérico dentro de la rutina")
    series: Optional[int] = Field(None, gt=0, description="Número de series programadas")
    reps: Optional[str] = Field(None, max_length=50, description="Rango de repeticiones (ej: '8-12', 'Al fallo')")
    peso_sugerido: Optional[str] = Field(None, max_length=50, description="Peso sugerido (ej: '20 kg', 'RPE 8')")
    descanso_seg: Optional[int] = Field(None, ge=0, description="Segundos de descanso entre series")


class RutinaItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ejercicio_id: UUID
    ejercicio_nombre: str
    ejercicio_grupo_muscular: Optional[str] = None
    ejercicio_equipo: Optional[str] = None
    ejercicio_archivo_url: Optional[str] = None  # None si el ejercicio está desactivado en la sede (Regla RF-28)
    ejercicio_activo_en_gym: bool = True
    orden: int
    series: Optional[int] = None
    reps: Optional[str] = None
    peso_sugerido: Optional[str] = None
    descanso_seg: Optional[int] = None


class CrearPlantillaRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=150, description="Nombre de la plantilla de rutina")
    descripcion: Optional[str] = Field(None, description="Objetivo o descripción de la rutina")
    items: List[RutinaItemInput] = Field(..., min_length=1, description="Lista de ejercicios que componen la rutina")


class EditarPlantillaRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=150)
    descripcion: Optional[str] = None
    version: int = Field(..., description="Versión para control de concurrencia optimista")
    items: List[RutinaItemInput] = Field(..., min_length=1)


class RutinaPlantillaListItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nombre: str
    descripcion: Optional[str] = None
    entrenador_id: Optional[UUID] = None
    entrenador_nombre: Optional[str] = None
    total_ejercicios: int = 0
    version: int
    created_at: datetime
    updated_at: datetime


class RutinaPlantillaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nombre: str
    descripcion: Optional[str] = None
    entrenador_id: Optional[UUID] = None
    entrenador_nombre: Optional[str] = None
    version: int
    items: List[RutinaItemResponse]
    created_at: datetime
    updated_at: datetime


class PlantillasPaginadasResponse(BaseModel):
    items: List[RutinaPlantillaListItemResponse]
    total: int
    skip: int
    limit: int


# =============================================================================
# 3. ESQUEMAS PARA RUTINAS ASIGNADAS (SNAPSHOT INMUTABLE - RF-30, RF-31)
# =============================================================================

class AsignarRutinaRequest(BaseModel):
    deportista_id: UUID
    plantilla_id: Optional[UUID] = Field(None, description="Plantilla origen opcional")
    nombre: Optional[str] = Field(None, min_length=2, max_length=150, description="Nombre de la rutina asignada. Por defecto toma el nombre de la plantilla")
    items: Optional[List[RutinaItemInput]] = Field(None, description="Items personalizados opcionales. Si es None, se copian de la plantilla")


class PersonalizarRutinaAsignadaRequest(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=150, description="Nuevo nombre para la versión personalizada")
    items: List[RutinaItemInput] = Field(..., min_length=1, description="Nuevos items que conformarán el snapshot personalizado")


class CambiarEstadoRutinaAsignadaRequest(BaseModel):
    activa: bool = Field(..., description="True para activar, False para archivar/desactivar")


class RutinaAsignadaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: UUID
    deportista_id: UUID
    deportista_nombre: Optional[str] = None
    plantilla_id: Optional[UUID] = None
    entrenador_id: Optional[UUID] = None
    entrenador_nombre: Optional[str] = None
    nombre: str
    activa: bool
    asignada_en: datetime
    created_at: datetime
    items: List[RutinaItemResponse]
