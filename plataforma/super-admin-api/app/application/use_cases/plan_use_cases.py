"""Planes de suscripción del SaaS (SA-RF-33, contrato 3.1)."""
from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BusinessRuleException, EntityConflictException, EntityNotFoundException
)
from app.core.fechas import hoy_bogota
from app.infrastructure.models.superadmin_models import (
    Gimnasio, PlanSuscripcion, Suscripcion, UsuarioInterno
)
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.presentation.schemas.plan_schemas import PlanCreate, PlanUpdate

_CAMPOS_EDITABLES = (
    "nombre", "descripcion", "precio", "duracion_meses", "dias_prueba",
    "max_clientes_activos", "max_staff", "publico", "orden",
)


def plan_a_dict(p: PlanSuscripcion) -> Dict:
    return {
        "id": p.id, "codigo": p.codigo, "nombre": p.nombre, "descripcion": p.descripcion,
        "tipo": p.tipo, "precio": int(p.precio or 0), "duracion_meses": p.duracion_meses,
        "dias_prueba": p.dias_prueba, "max_clientes_activos": p.max_clientes_activos,
        "max_staff": p.max_staff, "activo": p.activo, "publico": p.publico, "orden": p.orden,
        "version": p.version,
    }


class PlanUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.audit_repo = AuditRepository(db)

    # ------------------------------------------------------------------
    @staticmethod
    def _validar_coherencia(tipo: str, precio: int, duracion_meses: Optional[int], dias_prueba: Optional[int]):
        """Misma regla que el CHECK plan_tipo_coherente de la migración 003, con mensaje claro."""
        if tipo == "prueba":
            if dias_prueba is None or duracion_meses is not None or precio != 0:
                raise BusinessRuleException(
                    "El plan de prueba exige días de prueba, precio 0 y sin duración en meses.",
                    codigo="PLAN_INCOHERENTE",
                )
        elif tipo == "pago":
            if duracion_meses is None or dias_prueba is not None:
                raise BusinessRuleException(
                    "Un plan de pago exige duración en meses y no lleva días de prueba.",
                    codigo="PLAN_INCOHERENTE",
                )

    def obtener(self, plan_id: str) -> PlanSuscripcion:
        plan = self.db.get(PlanSuscripcion, plan_id)
        if not plan:
            raise EntityNotFoundException("Plan", plan_id, codigo="PLAN_NO_ENCONTRADO")
        return plan

    def obtener_disponible(self, plan_id: str) -> PlanSuscripcion:
        plan = self.db.get(PlanSuscripcion, plan_id)
        if not plan or not plan.activo:
            raise BusinessRuleException("El plan no existe o está inactivo.", codigo="PLAN_NO_DISPONIBLE")
        return plan

    def gimnasios_por_plan(self) -> Dict[str, int]:
        """Gimnasios vigentes (no cancelados ni eliminados) cuyo plan actual es cada plan."""
        conteo: Dict[str, int] = {}
        gyms = self.db.query(Gimnasio).filter(
            Gimnasio.deleted_at.is_(None), Gimnasio.estado != "cancelado"
        ).all()
        for g in gyms:
            actual = g.suscripciones[0] if g.suscripciones else None
            if actual and actual.plan_id:
                conteo[actual.plan_id] = conteo.get(actual.plan_id, 0) + 1
        return conteo

    def listar(self) -> List[Tuple[PlanSuscripcion, int]]:
        conteo = self.gimnasios_por_plan()
        planes = self.db.query(PlanSuscripcion).order_by(
            PlanSuscripcion.orden.asc(), PlanSuscripcion.precio.asc()
        ).all()
        return [(p, conteo.get(p.id, 0)) for p in planes]

    def listar_publicos(self) -> List[PlanSuscripcion]:
        return self.db.query(PlanSuscripcion).filter(
            PlanSuscripcion.activo.is_(True), PlanSuscripcion.publico.is_(True)
        ).order_by(PlanSuscripcion.orden.asc(), PlanSuscripcion.precio.asc()).all()

    # ------------------------------------------------------------------
    def crear(self, data: PlanCreate, actor: UsuarioInterno) -> PlanSuscripcion:
        self._validar_coherencia(data.tipo, data.precio, data.duracion_meses, data.dias_prueba)
        if self.db.query(PlanSuscripcion).filter(PlanSuscripcion.codigo == data.codigo).first():
            raise EntityConflictException(f"Ya existe un plan con el código '{data.codigo}'.", codigo="CODIGO_DUPLICADO")
        plan = PlanSuscripcion(**data.model_dump())
        try:
            self.db.add(plan)
            self.db.flush()
            self.audit_repo.record_action(
                actor_id=actor.id, actor_nombre=actor.nombre, accion="CREACION_PLAN",
                entidad="planes_suscripcion", entidad_id=plan.id, detalle=plan_a_dict(plan), commit=False,
            )
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise EntityConflictException(f"Ya existe un plan con el código '{data.codigo}'.", codigo="CODIGO_DUPLICADO")
        self.db.refresh(plan)
        return plan

    def actualizar(self, plan_id: str, data: PlanUpdate, actor: UsuarioInterno) -> PlanSuscripcion:
        plan = self.obtener(plan_id)
        if data.codigo is not None or data.tipo is not None:
            raise BusinessRuleException("El código y el tipo del plan no se pueden editar.", codigo="CAMPO_NO_EDITABLE")
        if data.version != plan.version:
            raise EntityConflictException(
                "Otra persona modificó este plan. Recargue para ver los cambios.",
                details={"version_actual": plan.version}, codigo="VERSION_DESACTUALIZADA",
            )
        nuevos = data.model_dump(include=set(_CAMPOS_EDITABLES))
        self._validar_coherencia(plan.tipo, nuevos["precio"], nuevos["duracion_meses"], nuevos["dias_prueba"])
        antes = plan_a_dict(plan)
        for k, v in nuevos.items():
            setattr(plan, k, v)
        plan.version = plan.version + 1
        self.db.flush()
        self.audit_repo.record_action(
            actor_id=actor.id, actor_nombre=actor.nombre, accion="ACTUALIZACION_PLAN",
            entidad="planes_suscripcion", entidad_id=plan.id,
            detalle={"antes": antes, "despues": plan_a_dict(plan)}, commit=False,
        )
        self.db.commit()
        self.db.refresh(plan)
        return plan

    def cambiar_estado(self, plan_id: str, activo: bool, actor: UsuarioInterno) -> PlanSuscripcion:
        plan = self.obtener(plan_id)
        anterior = plan.activo
        plan.activo = activo
        plan.version = plan.version + 1
        self.db.flush()
        self.audit_repo.record_action(
            actor_id=actor.id, actor_nombre=actor.nombre,
            accion="ACTIVACION_PLAN" if activo else "DESACTIVACION_PLAN",
            entidad="planes_suscripcion", entidad_id=plan.id,
            detalle={"activo_anterior": anterior, "activo": activo}, commit=False,
        )
        self.db.commit()
        self.db.refresh(plan)
        return plan

    # ------------------------------------------------------------------
    def asignar_plan(
        self,
        gym: Gimnasio,
        plan: PlanSuscripcion,
        vigente_desde: date,
        actor: UsuarioInterno,
        origen: str,
    ) -> Suscripcion:
        """Cierra la suscripción vigente y abre una nueva con el plan (no retroactivo, SA-RF-14).
        Sin commit: lo usan el cambio manual y la aprobación de solicitudes."""
        actual = self.db.query(Suscripcion).filter(
            Suscripcion.gimnasio_id == gym.id, Suscripcion.vigente_hasta.is_(None)
        ).order_by(Suscripcion.vigente_desde.desc(), Suscripcion.created_at.desc()).first()
        if actual and vigente_desde < actual.vigente_desde:
            raise BusinessRuleException(
                "La vigencia del nuevo plan no puede ser anterior a la de la suscripción actual.",
                details={"vigente_desde_actual": str(actual.vigente_desde)}, codigo="VIGENCIA_INVALIDA",
            )
        if actual:
            actual.vigente_hasta = vigente_desde
        nueva = Suscripcion(
            gimnasio_id=gym.id,
            valor_mensual=plan.precio,
            tipo_inicio=actual.tipo_inicio if actual else ("prueba" if plan.tipo == "prueba" else "cliente_activo"),
            vigente_desde=vigente_desde,
            vigente_hasta=None,
            plan_id=plan.id,
        )
        self.db.add(nueva)
        self.db.flush()
        self.audit_repo.record_action(
            actor_id=actor.id, actor_nombre=actor.nombre, accion="CAMBIO_PLAN_GIMNASIO",
            entidad="suscripciones", entidad_id=nueva.id, gimnasio_id=gym.id,
            detalle={
                "plan_anterior_id": actual.plan_id if actual else None,
                "plan_nuevo_id": plan.id, "plan_nuevo": plan.nombre,
                "valor_mensual": int(plan.precio or 0), "vigente_desde": str(vigente_desde), "origen": origen,
            },
            commit=False,
        )
        return nueva

    def cambiar_plan_gimnasio(
        self, gym_id: str, plan_id: str, vigente_desde: Optional[date], actor: UsuarioInterno
    ) -> Tuple[Gimnasio, PlanSuscripcion, Suscripcion]:
        """PATCH /admin/gyms/{id}/plan: cambio de plan manual por MVC (contrato 3.1)."""
        gym = self.db.query(Gimnasio).filter(Gimnasio.id == gym_id, Gimnasio.deleted_at.is_(None)).first()
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)
        if gym.estado == "cancelado":
            raise BusinessRuleException("Un gimnasio cancelado no admite cambios de plan.", codigo="GIMNASIO_CANCELADO")
        plan = self.obtener_disponible(plan_id)
        actual = gym.suscripciones[0] if gym.suscripciones else None
        if actual and actual.plan_id == plan.id:
            raise BusinessRuleException("El gimnasio ya tiene ese plan.", codigo="PLAN_SIN_CAMBIO")
        desde = vigente_desde or hoy_bogota()
        if actual and desde < actual.vigente_desde:
            raise BusinessRuleException(
                "La vigencia del nuevo plan no puede ser anterior a la de la suscripción actual.",
                details={"vigente_desde_actual": str(actual.vigente_desde)}, codigo="VIGENCIA_INVALIDA",
            )
        try:
            nueva = self.asignar_plan(gym, plan, desde, actor, origen="cambio_manual")
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return gym, plan, nueva
