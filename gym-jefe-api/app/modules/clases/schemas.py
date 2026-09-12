from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProgramarClaseRequest(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=100, description="Nombre de la clase (ej. Spinning 7AM)")
    tipo: Optional[str] = Field(None, max_length=50, description="Tipo o disciplina (ej. Spinning, Yoga, Crossfit)")
    entrenador_id: Optional[UUID] = Field(None, description="ID del instructor del staff interno")
    profesor_externo: Optional[str] = Field(None, max_length=100, description="Nombre del profesor externo si aplica")
    cupo: int = Field(..., gt=0, le=500, description="Cupo máximo de participantes")
    fecha_hora: datetime = Field(..., description="Fecha y hora de inicio de la clase")
    duracion_minutos: int = Field(default=60, gt=0, le=360, description="Duración en minutos de cada sesión")
    recurrente: bool = Field(default=False, description="Indica si es una serie recurrente")
    dias_semana: Optional[List[int]] = Field(
        default=None,
        description="Días de la semana para recurrencia (0=Lunes, 1=Martes, ..., 6=Domingo)"
    )
    semanas_a_proyectar: int = Field(
        default=4, ge=1, le=12,
        description="Semanas a proyectar para clases recurrentes (máximo 12 semanas)"
    )
    omitir_festivos: bool = Field(
        default=False,
        description="Si es True, no programa sesiones en días festivos oficiales de Colombia (RF-32)"
    )

    @model_validator(mode="after")
    def validar_profesor_y_recurrencia(self):
        # Validación de constraint clase_profesor: Entrenador interno O profesor externo
        if not self.entrenador_id and not (self.profesor_externo and self.profesor_externo.strip()):
            raise ValueError("Debe asignar un profesor: seleccione un entrenador del sistema o ingrese el nombre del profesor externo")
        
        # Validación de recurrencia
        if self.recurrente and not self.dias_semana:
            raise ValueError("Para clases recurrentes debe especificar al menos un día de la semana (0=Lunes ... 6=Domingo)")
        
        return self


class EditarClaseRequest(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=100)
    tipo: Optional[str] = Field(None, max_length=50)
    entrenador_id: Optional[UUID] = None
    profesor_externo: Optional[str] = Field(None, max_length=100)
    cupo: Optional[int] = Field(None, gt=0, le=500)
    fecha_hora: Optional[datetime] = None


class ClaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: UUID
    nombre: str
    tipo: Optional[str] = None
    entrenador_id: Optional[UUID] = None
    entrenador_nombre: Optional[str] = None
    profesor_externo: Optional[str] = None
    cupo: int
    fecha_hora: datetime
    recurrente: bool
    regla_recurrencia: Optional[str] = None
    omitir_festivos: bool
    estado: Literal["programada", "cancelada", "realizada"]
    reservas_totales: int = 0
    cupos_disponibles: int = 0
    asistencias_totales: int = 0
    created_at: datetime


class ClasesPaginadasResponse(BaseModel):
    items: List[ClaseResponse]
    total: int
    skip: int
    limit: int


class CrearReservaRequest(BaseModel):
    deportista_id: UUID
    venta_item_id: Optional[UUID] = Field(
        None,
        description="ID del ítem de venta (tipo='pase_clase') generado en Caja. Obligatorio para deportistas sin membresía activa (RF-33)."
    )


class ReservaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: UUID
    clase_id: UUID
    clase_nombre: Optional[str] = None
    clase_fecha_hora: Optional[datetime] = None
    deportista_id: UUID
    deportista_nombre: Optional[str] = None
    deportista_documento: Optional[str] = None
    estado: Literal["reservada", "cancelada", "asistio", "no_show"]
    pase_pagado: bool
    venta_item_id: Optional[UUID] = None
    created_at: datetime


class RegistrarAsistenciaRequest(BaseModel):
    deportista_id: UUID


class AsistenciaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: UUID
    clase_id: UUID
    deportista_id: UUID
    deportista_nombre: Optional[str] = None
    deportista_documento: Optional[str] = None
    checkin_id: int
    check_in: datetime
    created_at: datetime


class ResumenAsistenciaClaseResponse(BaseModel):
    clase_id: UUID
    clase_nombre: str
    clase_fecha_hora: datetime
    cupo_total: int
    total_reservas: int
    total_asistieron: int
    total_ausentes: int
    asistentes: List[AsistenciaResponse]
    ausentes: List[ReservaResponse]


class CrearCalificacionRequest(BaseModel):
    deportista_id: UUID
    puntaje: int = Field(..., ge=1, le=5, description="Puntuación de 1 a 5 estrellas")
    comentario: Optional[str] = Field(None, max_length=500, description="Comentario u opinión opcional")


class CalificacionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    gimnasio_id: UUID
    clase_id: UUID
    deportista_id: UUID
    deportista_nombre: Optional[str] = None
    puntaje: int
    comentario: Optional[str] = None
    created_at: datetime


class ResumenCalificacionesResponse(BaseModel):
    clase_id: UUID
    promedio_puntaje: float
    total_calificaciones: int
    calificaciones: List[CalificacionResponse]
