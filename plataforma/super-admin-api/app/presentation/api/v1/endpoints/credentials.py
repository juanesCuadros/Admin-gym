from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.dependencies import get_current_admin_user
from app.application.use_cases.credentials_use_cases import CredentialsUseCases
from app.presentation.schemas.gym_schemas import CredentialsIssuanceResponse

router = APIRouter(prefix="/admin/gyms/{gym_id}/credentials", tags=["Credenciales"])

@router.post("/regenerate", response_model=CredentialsIssuanceResponse, summary="Regenerar credenciales del Jefe")
def regenerate_credentials(
    gym_id: str,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-12: Regenerar credenciales, invalidando la contraseña temporal anterior
    y emitiendo una nueva clave con 72 horas de vigencia.
    """
    use_cases = CredentialsUseCases(db)
    return use_cases.regenerate_credentials(gym_id, actor=current_user)

@router.post("/resend", response_model=CredentialsIssuanceResponse, summary="Reenviar recordatorio de credenciales")
def resend_credentials(
    gym_id: str,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-13: Reenviar las credenciales existentes solo si el Jefe no ha cambiado
    la contraseña y esta no ha vencido.
    """
    use_cases = CredentialsUseCases(db)
    return use_cases.resend_credentials(gym_id, actor=current_user)
