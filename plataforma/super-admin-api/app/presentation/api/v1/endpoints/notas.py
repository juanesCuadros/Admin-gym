from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_admin_user
from app.core.exceptions import EntityNotFoundException
from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import Gimnasio, NotaGimnasio, UsuarioInterno
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.presentation.schemas.nota_schemas import CrearNotaRequest, NotaResponse

router = APIRouter(prefix="/admin/gyms/{gym_id}/notas", tags=["Notas internas"])


def _respuesta(nota: NotaGimnasio) -> NotaResponse:
    return NotaResponse(
        id=str(nota.id),
        texto=nota.texto,
        autor_nombre=nota.autor.nombre if nota.autor else None,
        created_at=nota.created_at,
    )


def _gimnasio(db: Session, gym_id: str) -> Gimnasio:
    gym = db.query(Gimnasio).filter(Gimnasio.id == gym_id).first()
    if not gym:
        raise EntityNotFoundException("Gimnasio", gym_id)
    return gym


@router.get("", response_model=List[NotaResponse], summary="Notas internas del gimnasio (SA-RF-28)")
def listar_notas(
    gym_id: str,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user),
):
    """Notas de MVC sobre el gimnasio, de la más reciente a la más antigua. El Jefe no las ve."""
    _gimnasio(db, gym_id)
    notas = (
        db.query(NotaGimnasio)
        .filter(NotaGimnasio.gimnasio_id == gym_id)
        .order_by(NotaGimnasio.created_at.desc())
        .all()
    )
    return [_respuesta(n) for n in notas]


@router.post("", response_model=NotaResponse, status_code=status.HTTP_201_CREATED, summary="Agregar nota interna (SA-RF-28)")
def crear_nota(
    gym_id: str,
    data: CrearNotaRequest,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user),
):
    """CA1: guarda texto, autor y fecha. Las notas no se editan ni se borran."""
    gym = _gimnasio(db, gym_id)
    nota = NotaGimnasio(gimnasio_id=gym.id, autor_id=current_user.id, texto=data.texto)
    db.add(nota)
    db.flush()
    AuditRepository(db).record_action(
        actor_id=current_user.id,
        actor_nombre=current_user.nombre,
        accion="NOTA_INTERNA_CREADA",
        entidad="notas_gimnasio",
        entidad_id=nota.id,
        gimnasio_id=gym.id,
        commit=False,
    )
    db.commit()
    db.refresh(nota)
    return _respuesta(nota)
