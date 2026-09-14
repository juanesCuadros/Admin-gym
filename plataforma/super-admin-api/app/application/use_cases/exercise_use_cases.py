from typing import List, Dict, Any, Tuple
from sqlalchemy.orm import Session
from app.infrastructure.models.platform_models import Ejercicio
from app.infrastructure.models.superadmin_models import ImportacionesEjercicios, UsuarioInterno
from app.infrastructure.repositories.exercise_repository import ExerciseRepository
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.core.exceptions import EntityNotFoundException, EntityConflictException
from app.presentation.schemas.exercise_schemas import (
    ExerciseCreate, ExerciseUpdate, ExerciseDatasetItem
)

class ExerciseUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ExerciseRepository(db)
        self.audit_repo = AuditRepository(db)

    def create_exercise(self, data: ExerciseCreate, actor: UsuarioInterno) -> Ejercicio:
        existing = self.repo.get_global_by_name(data.nombre_es)
        if existing:
            raise EntityConflictException(f"Ya existe un ejercicio global con el nombre '{data.nombre_es}'.")

        exercise = Ejercicio(
            gimnasio_id=None,  # Global catalog
            propio=False,
            nombre_es=data.nombre_es.strip(),
            nombre_en=data.nombre_en.strip() if data.nombre_en else None,
            instrucciones=data.instrucciones,
            grupo_muscular=data.grupo_muscular,
            equipo=data.equipo,
            categoria=data.categoria,
            archivo_url=data.archivo_url,
            activo=data.activo
        )
        saved = self.repo.save(exercise)

        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="CREACION_EJERCICIO_GLOBAL",
            entidad="ejercicios",
            entidad_id=saved.id,
            detalle={"nombre_es": saved.nombre_es, "grupo_muscular": saved.grupo_muscular}
        )
        return saved

    def update_exercise(self, exercise_id: str, data: ExerciseUpdate, actor: UsuarioInterno) -> Ejercicio:
        exercise = self.repo.get_by_id(exercise_id)
        if not exercise or exercise.gimnasio_id is not None:
            raise EntityNotFoundException("Ejercicio global", exercise_id)

        update_dict = data.model_dump(exclude_unset=True)
        for field, val in update_dict.items():
            setattr(exercise, field, val)

        exercise.version += 1
        saved = self.repo.save(exercise)

        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="ACTUALIZACION_EJERCICIO_GLOBAL",
            entidad="ejercicios",
            entidad_id=saved.id,
            detalle=update_dict
        )
        return saved

    def toggle_status(self, exercise_id: str, activo: bool, actor: UsuarioInterno) -> Ejercicio:
        exercise = self.repo.get_by_id(exercise_id)
        if not exercise or exercise.gimnasio_id is not None:
            raise EntityNotFoundException("Ejercicio global", exercise_id)

        exercise.activo = activo
        exercise.version += 1
        saved = self.repo.save(exercise)

        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="ESTADO_EJERCICIO_GLOBAL",
            entidad="ejercicios",
            entidad_id=saved.id,
            detalle={"activo": activo}
        )
        return saved

    def import_dataset(
        self,
        dataset_name: str,
        items: List[ExerciseDatasetItem],
        update_existing: bool,
        actor: UsuarioInterno
    ) -> Dict[str, Any]:
        """
        Batch imports a dataset of exercises without duplicating (RF-24).
        """
        total = len(items)
        inserted = 0
        updated = 0
        ignored = 0

        for item in items:
            existing = self.repo.get_global_by_name(item.nombre_es)
            if existing:
                if update_existing:
                    existing.nombre_en = item.nombre_en or existing.nombre_en
                    existing.instrucciones = item.instrucciones or existing.instrucciones
                    existing.grupo_muscular = item.grupo_muscular or existing.grupo_muscular
                    existing.equipo = item.equipo or existing.equipo
                    existing.categoria = item.categoria or existing.categoria
                    existing.archivo_url = item.archivo_url or existing.archivo_url
                    existing.version += 1
                    self.db.add(existing)
                    updated += 1
                else:
                    ignored += 1
            else:
                new_ex = Ejercicio(
                    gimnasio_id=None,
                    propio=False,
                    nombre_es=item.nombre_es.strip(),
                    nombre_en=item.nombre_en.strip() if item.nombre_en else None,
                    instrucciones=item.instrucciones,
                    grupo_muscular=item.grupo_muscular,
                    equipo=item.equipo,
                    categoria=item.categoria,
                    archivo_url=item.archivo_url,
                    activo=True
                )
                self.db.add(new_ex)
                inserted += 1

        self.db.commit()

        # Audit import
        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="IMPORTACION_DATASET_EJERCICIOS",
            entidad="ejercicios",
            detalle={
                "dataset": dataset_name,
                "total": total,
                "insertados": inserted,
                "actualizados": updated,
                "ignorados": ignored
            }
        )

        return {
            "dataset": dataset_name,
            "total": total,
            "insertados": inserted,
            "actualizados": updated,
            "ignorados": ignored,
            "mensaje": f"Dataset '{dataset_name}' procesado con éxito: {inserted} creados, {updated} actualizados, {ignored} ignorados."
        }
