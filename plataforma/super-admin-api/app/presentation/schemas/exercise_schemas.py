from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

class ExerciseCreate(BaseModel):
    nombre_es: str = Field(..., min_length=2, max_length=150, description="Nombre en español")
    nombre_en: Optional[str] = Field(None, max_length=150, description="Nombre en inglés")
    instrucciones: Optional[str] = Field(None, description="Instrucciones técnicas de ejecución")
    grupo_muscular: Optional[str] = Field(None, max_length=100, description="Grupo muscular principal (Pecho, Espalda, Piernas, Hombros, etc.)")
    equipo: Optional[str] = Field(None, max_length=100, description="Equipamiento requerido (Mancuernas, Barra, Polea, Peso corporal)")
    categoria: Optional[str] = Field(None, max_length=100, description="Categoría (Fuerza, Cardio, Movilidad, Hipertrofia)")
    archivo_url: Optional[str] = Field(None, description="URL del archivo multimedia o GIF ilustrativo")
    activo: bool = True

class ExerciseUpdate(BaseModel):
    nombre_es: Optional[str] = None
    nombre_en: Optional[str] = None
    instrucciones: Optional[str] = None
    grupo_muscular: Optional[str] = None
    equipo: Optional[str] = None
    categoria: Optional[str] = None
    archivo_url: Optional[str] = None
    activo: Optional[bool] = None

class ExerciseToggleStatus(BaseModel):
    activo: bool

class ExerciseDatasetItem(BaseModel):
    nombre_es: str
    nombre_en: Optional[str] = None
    instrucciones: Optional[str] = None
    grupo_muscular: Optional[str] = None
    equipo: Optional[str] = None
    categoria: Optional[str] = None
    archivo_url: Optional[str] = None

class ExerciseImportRequest(BaseModel):
    dataset_nombre: str = Field(..., description="Nombre del dataset, ej: Wger / GymOS Standard v1")
    ejercicios: List[ExerciseDatasetItem] = Field(..., min_length=1)
    modo_actualizacion: bool = Field(True, description="Si es True, actualiza los existentes; si es False, ignora los existentes")

class ExerciseImportResponse(BaseModel):
    dataset: str
    total: int
    insertados: int
    actualizados: int
    ignorados: int
    mensaje: str

class ExerciseResponse(BaseModel):
    id: str
    propio: bool
    nombre_es: str
    nombre_en: Optional[str] = None
    instrucciones: Optional[str] = None
    grupo_muscular: Optional[str] = None
    equipo: Optional[str] = None
    categoria: Optional[str] = None
    archivo_url: Optional[str] = None
    activo: bool
    version: int
    created_at: datetime
    updated_at: datetime
