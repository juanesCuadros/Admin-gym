"""
Router de la carga inicial de clientes (GW-RF-55, contrato 2.4). Solo el Jefe.
"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_session
from app.core.dependencies import AuthenticatedStaff, require_role
from app.modules.carga_inicial.schemas import AplicacionCargaResponse, SimulacionCargaResponse
from app.modules.carga_inicial.service import MAX_BYTES, CargaInicialService

router = APIRouter(prefix="/carga-inicial", tags=["Carga inicial de clientes"])


async def _leer(archivo: UploadFile) -> bytes:
    # Se lee un byte de más para detectar archivos que superan el límite sin cargarlos completos.
    return await archivo.read(MAX_BYTES + 1)


@router.get(
    "/plantilla",
    summary="Plantilla vacía de la carga inicial (GW-RF-55)",
)
async def descargar_plantilla(
    staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    formato: Literal["csv", "xlsx"] = Query("xlsx", description="csv o xlsx"),
):
    contenido, media_type, nombre = CargaInicialService.plantilla(formato)
    return Response(
        content=contenido,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


@router.post(
    "/simular",
    response_model=SimulacionCargaResponse,
    status_code=status.HTTP_200_OK,
    summary="Valida el archivo y devuelve los errores por fila sin guardar (GW-RF-55)",
)
async def simular_carga(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    archivo: UploadFile = File(..., description="Plantilla .csv o .xlsx diligenciada"),
):
    return await CargaInicialService.simular(
        session=session,
        gym_id=staff.gimnasio_id,
        nombre_archivo=archivo.filename,
        contenido=await _leer(archivo),
    )


@router.post(
    "/aplicar",
    response_model=AplicacionCargaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Carga todos los clientes del archivo o ninguno (GW-RF-55)",
)
async def aplicar_carga(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    staff: Annotated[AuthenticatedStaff, Depends(require_role("jefe"))],
    archivo: UploadFile = File(..., description="Plantilla .csv o .xlsx diligenciada"),
    declara_consentimientos: bool = Form(
        False,
        description="El Jefe declara que el gimnasio conserva la autorización de datos (Ley 1581) de estos clientes",
    ),
):
    return await CargaInicialService.aplicar(
        session=session,
        gym_id=staff.gimnasio_id,
        staff_id=staff.id,
        staff_nombre=staff.nombre,
        nombre_archivo=archivo.filename,
        contenido=await _leer(archivo),
        declara_consentimientos=declara_consentimientos,
    )
