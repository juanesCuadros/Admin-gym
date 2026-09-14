from typing import Optional, List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.dependencies import get_current_admin_user
from app.infrastructure.repositories.exercise_repository import ExerciseRepository
from app.application.use_cases.exercise_use_cases import ExerciseUseCases
from app.presentation.schemas.exercise_schemas import (
    ExerciseCreate, ExerciseUpdate, ExerciseToggleStatus,
    ExerciseImportRequest, ExerciseImportResponse, ExerciseResponse
)

router = APIRouter(prefix="/admin/exercises", tags=["Catálogo Multimedia Global"])

@router.get("", response_model=List[ExerciseResponse], summary="Listar y buscar ejercicios del catálogo global")
def list_exercises(
    search: Optional[str] = Query(None, description="Búsqueda por nombre o equipo"),
    grupo_muscular: Optional[str] = Query(None, description="Filtrar por grupo muscular"),
    categoria: Optional[str] = Query(None, description="Filtrar por categoría"),
    activo: Optional[bool] = Query(None, description="Filtrar por estado activo/inactivo"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-21: Listar, buscar y filtrar ejercicios del catálogo global.
    """
    repo = ExerciseRepository(db)
    items, total = repo.list_global_exercises(
        search=search,
        grupo_muscular=grupo_muscular,
        categoria=categoria,
        activo=activo,
        limit=limit,
        offset=offset
    )
    return [
        ExerciseResponse(
            id=e.id,
            propio=e.propio,
            nombre_es=e.nombre_es,
            nombre_en=e.nombre_en,
            instrucciones=e.instrucciones,
            grupo_muscular=e.grupo_muscular,
            equipo=e.equipo,
            categoria=e.categoria,
            archivo_url=e.archivo_url,
            activo=e.activo,
            version=e.version,
            created_at=e.created_at,
            updated_at=e.updated_at
        )
        for e in items
    ]

@router.post("", response_model=ExerciseResponse, status_code=status.HTTP_201_CREATED, summary="Crear nuevo ejercicio global")
def create_exercise(
    data: ExerciseCreate,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-22: Crear ejercicio en el catálogo global.
    """
    use_cases = ExerciseUseCases(db)
    saved = use_cases.create_exercise(data, actor=current_user)
    return ExerciseResponse(
        id=saved.id,
        propio=saved.propio,
        nombre_es=saved.nombre_es,
        nombre_en=saved.nombre_en,
        instrucciones=saved.instrucciones,
        grupo_muscular=saved.grupo_muscular,
        equipo=saved.equipo,
        categoria=saved.categoria,
        archivo_url=saved.archivo_url,
        activo=saved.activo,
        version=saved.version,
        created_at=saved.created_at,
        updated_at=saved.updated_at
    )

@router.put("/{exercise_id}", response_model=ExerciseResponse, summary="Editar ejercicio global")
def update_exercise(
    exercise_id: str,
    data: ExerciseUpdate,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-22: Editar datos de un ejercicio existente.
    """
    use_cases = ExerciseUseCases(db)
    saved = use_cases.update_exercise(exercise_id, data, actor=current_user)
    return ExerciseResponse(
        id=saved.id,
        propio=saved.propio,
        nombre_es=saved.nombre_es,
        nombre_en=saved.nombre_en,
        instrucciones=saved.instrucciones,
        grupo_muscular=saved.grupo_muscular,
        equipo=saved.equipo,
        categoria=saved.categoria,
        archivo_url=saved.archivo_url,
        activo=saved.activo,
        version=saved.version,
        created_at=saved.created_at,
        updated_at=saved.updated_at
    )

@router.patch("/{exercise_id}/status", response_model=ExerciseResponse, summary="Activar o desactivar ejercicio global")
def toggle_exercise_status(
    exercise_id: str,
    data: ExerciseToggleStatus,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-23: Activar o desactivar ejercicios (no se eliminan si están en uso).
    """
    use_cases = ExerciseUseCases(db)
    saved = use_cases.toggle_status(exercise_id, data.activo, actor=current_user)
    return ExerciseResponse(
        id=saved.id,
        propio=saved.propio,
        nombre_es=saved.nombre_es,
        nombre_en=saved.nombre_en,
        instrucciones=saved.instrucciones,
        grupo_muscular=saved.grupo_muscular,
        equipo=saved.equipo,
        categoria=saved.categoria,
        archivo_url=saved.archivo_url,
        activo=saved.activo,
        version=saved.version,
        created_at=saved.created_at,
        updated_at=saved.updated_at
    )

@router.post("/import", response_model=ExerciseImportResponse, summary="Importar dataset de ejercicios en lote")
def import_exercises(
    data: ExerciseImportRequest,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-24: Importar un dataset de ejercicios sin duplicar (actualiza o ignora los existentes).
    """
    use_cases = ExerciseUseCases(db)
    res = use_cases.import_dataset(
        dataset_name=data.dataset_nombre,
        items=data.ejercicios,
        update_existing=data.modo_actualizacion,
        actor=current_user
    )
    return ExerciseImportResponse(**res)
