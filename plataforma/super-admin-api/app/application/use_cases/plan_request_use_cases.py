"""Solicitudes de cambio de plan hechas por el Jefe (contrato 3.1, SA-RF-33)."""
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.application.use_cases.payment_use_cases import PaymentUseCases
from app.application.use_cases.plan_use_cases import PlanUseCases
from app.core.exceptions import (
    BusinessRuleException, EntityConflictException, EntityNotFoundException, IdempotencyConflictException
)
from app.infrastructure.models.superadmin_models import (
    Gimnasio, Pago, SolicitudPlan, Suscripcion, UsuarioInterno
)
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.presentation.schemas.plan_request_schemas import AprobacionResponse, AprobarSolicitudRequest


class PlanRequestUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.audit_repo = AuditRepository(db)
        self.pagos = PaymentUseCases(db)
        self.planes = PlanUseCases(db)

    def listar(self, estado: Optional[str]) -> List[SolicitudPlan]:
        q = self.db.query(SolicitudPlan).join(Gimnasio, Gimnasio.id == SolicitudPlan.gimnasio_id).filter(
            Gimnasio.deleted_at.is_(None)
        )
        if estado:
            q = q.filter(SolicitudPlan.estado == estado)
        return q.order_by(SolicitudPlan.created_at.asc()).all()

    def _obtener(self, solicitud_id: str) -> SolicitudPlan:
        sol = self.db.get(SolicitudPlan, solicitud_id)
        if not sol:
            raise EntityNotFoundException("Solicitud de plan", solicitud_id, codigo="SOLICITUD_NO_ENCONTRADA")
        return sol

    @staticmethod
    def _aviso_monto(monto: int, precio: int, meses: int) -> Optional[str]:
        esperado = int(precio) * int(meses)
        if monto != esperado:
            return f"El monto ({monto}) no coincide con precio del plan × meses ({esperado}). Se registró igual."
        return None

    def _respuesta(self, sol: SolicitudPlan, pago: Pago, gym: Gimnasio) -> AprobacionResponse:
        sus = self.db.query(Suscripcion).filter(
            Suscripcion.gimnasio_id == gym.id, Suscripcion.plan_id == sol.plan_id
        ).order_by(Suscripcion.created_at.desc()).first()
        return AprobacionResponse(
            solicitud_id=sol.id, estado=sol.estado, pago_id=pago.id, monto=int(pago.monto), meses=pago.meses,
            fecha_pago=pago.fecha_pago, plan_id=sol.plan.id, plan_nombre=sol.plan.nombre,
            suscripcion_id=sus.id if sus else "", nueva_fecha_corte=gym.fecha_corte, estado_gimnasio=gym.estado,
            aviso_monto=self._aviso_monto(int(pago.monto), int(sol.plan.precio or 0), pago.meses),
        )

    def aprobar(
        self, solicitud_id: str, idempotency_key: str, data: AprobarSolicitudRequest, actor: UsuarioInterno
    ) -> AprobacionResponse:
        sol = self._obtener(solicitud_id)
        gym = self.db.get(Gimnasio, sol.gimnasio_id)

        # Reintento con la misma Idempotency-Key: devuelve el mismo resultado sin duplicar (SA-RF-16 CA2).
        previo = self.db.query(Pago).filter(Pago.idempotency_key == idempotency_key).first()
        if previo is not None:
            if sol.pago_id == previo.id:
                return self._respuesta(sol, previo, gym)
            raise IdempotencyConflictException(idempotency_key)

        if sol.estado != "pendiente":
            raise EntityConflictException(
                f"La solicitud ya fue {sol.estado}.", details={"estado": sol.estado}, codigo="SOLICITUD_NO_PENDIENTE"
            )
        if gym is None or gym.deleted_at is not None:
            raise EntityNotFoundException("Gimnasio", sol.gimnasio_id)
        if gym.estado == "cancelado":
            raise BusinessRuleException("Un gimnasio cancelado no acepta pagos.", codigo="GIMNASIO_CANCELADO")
        if gym.estado == "suspendido":
            raise BusinessRuleException(
                "Un gimnasio suspendido solo recibe pagos mediante la reactivación.", codigo="USAR_REACTIVACION"
            )
        plan = sol.plan
        if plan.tipo != "pago" or not plan.duracion_meses:
            raise BusinessRuleException("La solicitud no apunta a un plan de pago.", codigo="PLAN_NO_DISPONIBLE")
        self.pagos.validar_pago(data.fecha_pago, idempotency_key)

        actual = gym.suscripciones[0] if gym.suscripciones else None
        vigente_desde = data.fecha_pago
        if actual and vigente_desde < actual.vigente_desde:
            vigente_desde = actual.vigente_desde

        try:
            estado_anterior = gym.estado
            pago, nueva_corte = self.pagos.agregar_pago(
                gym, data.monto, plan.duracion_meses, data.fecha_pago, data.metodo, data.nota, idempotency_key, actor
            )
            self.planes.asignar_plan(gym, plan, vigente_desde, actor, origen="solicitud_aprobada")
            if gym.estado == "prueba":
                gym.estado = "activo"  # prueba → activo con el pago en la misma operación (§2.1)

            sol.estado = "aprobada"
            sol.pago_id = pago.id
            sol.resuelta_por = actor.id
            sol.resuelta_en = datetime.now(timezone.utc)

            self.audit_repo.record_action(
                actor_id=actor.id, actor_nombre=actor.nombre, accion="REGISTRO_PAGO", entidad="pagos",
                entidad_id=pago.id, gimnasio_id=gym.id,
                detalle={
                    "monto": int(pago.monto), "meses": pago.meses, "metodo": pago.metodo,
                    "fecha_pago": str(pago.fecha_pago), "fija_ancla": pago.fija_ancla,
                    "nueva_fecha_corte": str(nueva_corte), "origen": "solicitud_plan",
                },
                commit=False,
            )
            self.audit_repo.record_action(
                actor_id=actor.id, actor_nombre=actor.nombre, accion="SOLICITUD_PLAN_APROBADA",
                entidad="solicitudes_plan", entidad_id=sol.id, gimnasio_id=gym.id,
                detalle={"plan_id": plan.id, "plan": plan.nombre, "pago_id": pago.id,
                         "estado_anterior": estado_anterior, "estado_nuevo": gym.estado},
                commit=False,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(gym)
        return self._respuesta(sol, pago, gym)

    def rechazar(self, solicitud_id: str, motivo: str, actor: UsuarioInterno) -> SolicitudPlan:
        sol = self._obtener(solicitud_id)
        if sol.estado != "pendiente":
            raise EntityConflictException(
                f"La solicitud ya fue {sol.estado}.", details={"estado": sol.estado}, codigo="SOLICITUD_NO_PENDIENTE"
            )
        sol.estado = "rechazada"
        sol.motivo_rechazo = motivo.strip()
        sol.resuelta_por = actor.id
        sol.resuelta_en = datetime.now(timezone.utc)
        self.db.flush()
        self.audit_repo.record_action(
            actor_id=actor.id, actor_nombre=actor.nombre, accion="SOLICITUD_PLAN_RECHAZADA",
            entidad="solicitudes_plan", entidad_id=sol.id, gimnasio_id=sol.gimnasio_id,
            detalle={"plan_id": sol.plan_id, "motivo": sol.motivo_rechazo}, commit=False,
        )
        self.db.commit()
        self.db.refresh(sol)
        return sol
