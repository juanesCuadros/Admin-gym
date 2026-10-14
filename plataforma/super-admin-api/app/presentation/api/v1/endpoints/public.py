"""Rutas públicas (sin autenticación) del Super-Admin: contrato 3.2 y 3.4."""
from typing import List

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.application.use_cases.export_use_cases import ExportUseCases
from app.application.use_cases.plan_use_cases import PlanUseCases, plan_a_dict
from app.application.use_cases.signup_use_cases import MENSAJE_SIGNUP, SignupUseCases
from app.infrastructure.database.session import get_db
from app.presentation.schemas.plan_schemas import PlanPublicoResponse
from app.presentation.schemas.public_schemas import (
    MensajeResponse, SignupConfirmRequest, SignupConfirmResponse, SignupRequest, SignupTokenInfo,
    SubdominioCheckPublico
)

router = APIRouter(prefix="/public", tags=["Público"])


@router.get("/plans", response_model=List[PlanPublicoResponse], summary="Planes públicos (incluida la prueba)")
def planes_publicos(db: Session = Depends(get_db)):
    campos = PlanPublicoResponse.model_fields.keys()
    return [PlanPublicoResponse(**{k: v for k, v in plan_a_dict(p).items() if k in campos})
            for p in PlanUseCases(db).listar_publicos()]


@router.get("/subdomain-check", response_model=SubdominioCheckPublico, summary="Subdominio sugerido para un nombre")
def subdominio_publico(nombre: str = Query(..., min_length=2, max_length=150), db: Session = Depends(get_db)):
    sugerido, disponible = SignupUseCases(db).sugerir_subdominio(nombre)
    return SubdominioCheckPublico(subdominio_sugerido=sugerido, disponible=disponible)


@router.post("/signup", response_model=MensajeResponse, status_code=status.HTTP_202_ACCEPTED,
             summary="Registro autónomo: envía el enlace de confirmación")
def signup(data: SignupRequest, request: Request, db: Session = Depends(get_db)):
    """SA-RF-34: siempre 202 con el mismo mensaje (no revela si el correo existe)."""
    SignupUseCases(db).solicitar(data, request.client.host if request.client else None)
    return MensajeResponse(mensaje=MENSAJE_SIGNUP)


@router.get("/signup/{token}", response_model=SignupTokenInfo, summary="Validar enlace de registro")
def signup_info(token: str, db: Session = Depends(get_db)):
    r = SignupUseCases(db).consultar(token)
    return SignupTokenInfo(valido=True, nombre_gimnasio=r.nombre_gimnasio, subdominio_sugerido=r.subdominio_sugerido)


@router.post("/signup/{token}/confirm", response_model=SignupConfirmResponse, status_code=status.HTTP_201_CREATED,
             summary="Confirmar registro y crear el gimnasio en prueba")
def signup_confirm(token: str, data: SignupConfirmRequest, db: Session = Depends(get_db)):
    subdominio, url = SignupUseCases(db).confirmar(token, data.password)
    return SignupConfirmResponse(subdominio=subdominio, url_login=url)


@router.get("/exports/{token}", summary="Descargar la exportación ZIP de un gimnasio cancelado",
            response_class=FileResponse)
def descargar_exportacion(token: str, request: Request, db: Session = Depends(get_db)):
    """SA-RF-30: ZIP con CSV de deportistas, membresías, pagos y asistencia. 410 si venció o se
    eliminó. Cada descarga queda en auditoría."""
    ruta, nombre = ExportUseCases(db).descargar(token, request.client.host if request.client else None)
    return FileResponse(ruta, media_type="application/zip", filename=nombre)
