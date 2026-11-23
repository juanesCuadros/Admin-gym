"""
Huellas registradas en la estación (fase 4, E-43): tipo `huella_enrolar` de `/sync/push`.

- La estación captura y compara las huellas con su lector (la comparación ocurre en el equipo, también sin
  red). Al servidor sube la plantilla para guardarla cifrada (AES-256-GCM, como siempre) y no perderla si
  se reinstala la estación.
- Se reutiliza `DeportistasService.enrolar_huella`: mismo cifrado, mismo upsert por dedo y misma auditoría.
- Un cliente que ya no existe en el servidor es inválido (no hay dónde guardarla) y queda visible en la
  cola de la estación. Quien la registró sin permiso o desactivado: se guarda y queda por revisar.
"""
from typing import Literal, Optional
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.modules.deportistas.schemas import EnrolarHuellaRequest
from app.modules.deportistas.service import DeportistasService
from app.modules.sync.caja import _exigir_staff, _leer
from app.modules.sync.push import Contexto, Efecto, OperacionInvalida, Revision


class _PayloadHuella(BaseModel):
    deportista_id: UUID
    dedo: str = Field(..., min_length=2, max_length=50)
    # Formato de la plantilla: el del lector (ANSI 378 en DigitalPersona) o el simulado de pruebas.
    formato: Literal["ansi378", "iso19794", "simulado"]
    template_base64: str = Field(..., min_length=10, max_length=20_000)


async def _revision_permiso(ctx: Contexto) -> Optional[Revision]:
    staff = ctx.staff
    if not staff["activo"] or staff["deleted_at"] is not None:
        return Revision(entidad="huellas", entidad_id=None, motivo_codigo="STAFF_DESACTIVADO",
                        motivo=f"{staff['nombre']} registró una huella en la estación {ctx.estacion.nombre} y figura desactivado.")
    if staff["rol"] == "jefe":
        return None
    res = await ctx.session.execute(
        text("SELECT puede_crear FROM platform.permisos_rol WHERE gimnasio_id = :g AND rol = :r AND submodulo = 'deportistas'"),
        {"g": ctx.estacion.gimnasio_id, "r": staff["rol"]},
    )
    if not res.scalar_one_or_none():
        return Revision(entidad="huellas", entidad_id=None, motivo_codigo="STAFF_SIN_PERMISO",
                        motivo=f"{staff['nombre']} registró una huella en la estación {ctx.estacion.nombre} sin permiso de deportistas.")
    return None


async def enrolar(ctx: Contexto) -> Efecto:
    datos = _leer(_PayloadHuella, ctx, "La huella")
    staff = _exigir_staff(ctx, "La huella")
    try:
        r = await DeportistasService.enrolar_huella(
            session=ctx.session, gym_id=ctx.estacion.gimnasio_id, staff_id=staff["id"], staff_nombre=staff["nombre"],
            deportista_id=datos.deportista_id, req=EnrolarHuellaRequest(dedo=datos.dedo, template_base64=datos.template_base64),
        )
    except HTTPException as e:
        detalle = e.detail if isinstance(e.detail, dict) else {}
        raise OperacionInvalida(detalle.get("codigo", "HUELLA_INVALIDA"), detalle.get("mensaje", "No se pudo guardar la huella."))
    revision = await _revision_permiso(ctx)
    if revision:
        revision.entidad_id = str(r.id)
    return Efecto(respuesta={"huella_id": str(r.id), "dedo": r.dedo, "formato": datos.formato}, revision=revision)
