from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional
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


# --- Activación (la estación aún no tiene credencial) ---
class ActivarEstacionRequest(BaseModel):
    subdominio: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$")
    codigo: str = Field(..., min_length=8, max_length=16, description="Código de estación; se acepta con o sin guion")
    nombre_equipo: Optional[str] = Field(None, max_length=80, description="Nombre del computador, para reconocerlo en la lista")
    version_app: str = Field(..., min_length=1, max_length=20)


class GimnasioEstacionDto(BaseModel):
    id: UUID
    nombre: str
    subdominio: str


class EstacionActivadaDto(BaseModel):
    estacion_id: UUID
    nombre: str
    # Credencial de la estación. Solo viaja en esta respuesta; el servidor guarda su hash.
    device_token: str
    gimnasio: GimnasioEstacionDto


# --- Primer ingreso de una persona en la estación ---
class SesionStaffRequest(BaseModel):
    correo: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)


class StaffEstacionDto(BaseModel):
    id: UUID
    nombre: str
    correo: str
    rol: str
    # Cambia cuando la contraseña cambia en la web: la estación invalida su verificador y el PIN.
    password_cambiada_en: Optional[datetime] = None


class SesionStaffResponse(BaseModel):
    staff: StaffEstacionDto
    permisos: list[str]
    servidor_ahora: datetime


# --- Descarga hacia la estación ---
class SuscripcionEstacionDto(BaseModel):
    """Con esto la estación calcula el aviso y el bloqueo por su cuenta, aunque le quiten la red (P-01)."""
    estado_guardado: Optional[str] = None
    fecha_corte: Optional[date] = None
    estado_calculado: Optional[str] = None
    motivo_bloqueo: Optional[str] = None


class EliminadoDto(BaseModel):
    tabla: str
    id: UUID


class PullResponse(BaseModel):
    epoca: str
    # true: las marcas del servidor cambiaron; la estación borra su copia y descarga todo de nuevo.
    reiniciar: bool = False
    cursor: str
    hay_mas: bool
    cambios: Dict[str, List[Dict[str, Any]]]
    eliminados: List[EliminadoDto]
    suscripcion: Optional[SuscripcionEstacionDto] = None
    servidor_ahora: datetime


# --- Envío desde la estación ---
ResultadoOperacion = Literal["aplicada", "duplicada", "pendiente_revision", "invalida", "retenida"]


class PushRequest(BaseModel):
    # Cada operación se valida por separado: una mal formada no tumba el lote.
    operaciones: List[Dict[str, Any]] = Field(..., min_length=1, max_length=50)
    # Reloj del equipo al enviar. Con él el servidor mide el desfase y corrige la hora de los ingresos.
    estacion_ahora: Optional[datetime] = None


class ResultadoOperacionDto(BaseModel):
    indice: int
    id: Optional[UUID] = None
    resultado: ResultadoOperacion
    # Solo en `duplicada`: lo que se respondió la primera vez (aplicada o pendiente_revision).
    resultado_original: Optional[str] = None
    codigo: Optional[str] = None
    mensaje: Optional[str] = None
    datos: Optional[Dict[str, Any]] = None
    revision: Optional[Dict[str, Any]] = None


class PushResponse(BaseModel):
    resultados: List[ResultadoOperacionDto]
    servidor_ahora: datetime
