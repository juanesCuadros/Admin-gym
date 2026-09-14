from typing import Optional, List, Tuple, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from app.infrastructure.models.platform_models import Ejercicio

class ExerciseRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, exercise_id: str) -> Optional[Ejercicio]:
        return self.db.query(Ejercicio).filter(Ejercicio.id == exercise_id).first()

    def get_global_by_name(self, name_es: str) -> Optional[Ejercicio]:
        return self.db.query(Ejercicio).filter(
            Ejercicio.gimnasio_id.is_(None),
            func.lower(Ejercicio.nombre_es) == name_es.strip().lower()
        ).first()

    def list_global_exercises(
        self,
        search: Optional[str] = None,
        grupo_muscular: Optional[str] = None,
        categoria: Optional[str] = None,
        activo: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[Ejercicio], int]:
        query = self.db.query(Ejercicio).filter(Ejercicio.gimnasio_id.is_(None))

        if activo is not None:
            query = query.filter(Ejercicio.activo == activo)

        if grupo_muscular:
            query = query.filter(func.lower(Ejercicio.grupo_muscular) == grupo_muscular.strip().lower())

        if categoria:
            query = query.filter(func.lower(Ejercicio.categoria) == categoria.strip().lower())

        if search:
            pat = f"%{search.strip().lower()}%"
            query = query.filter(
                or_(
                    func.lower(Ejercicio.nombre_es).like(pat),
                    func.lower(Ejercicio.nombre_en).like(pat),
                    func.lower(Ejercicio.grupo_muscular).like(pat),
                    func.lower(Ejercicio.equipo).like(pat)
                )
            )

        total = query.count()
        items = query.order_by(Ejercicio.nombre_es.asc()).offset(offset).limit(limit).all()
        return items, total

    def save(self, exercise: Ejercicio) -> Ejercicio:
        self.db.add(exercise)
        self.db.commit()
        self.db.refresh(exercise)
        return exercise
