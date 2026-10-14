from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional, Tuple
from sqlalchemy.orm import Session

from app.infrastructure.models.superadmin_models import (
    Gimnasio, Pago, Suscripcion, UsuarioInterno
)
from app.infrastructure.repositories.payment_repository import PaymentRepository
from app.infrastructure.repositories.gym_repository import GymRepository
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.domain.services.cutting_date_calculator import CuttingDateCalculator, PagoCorte
from app.core.exceptions import (
    EntityNotFoundException, BusinessRuleException, EntityConflictException,
    IdempotencyConflictException
)
from app.core.config import settings
from app.presentation.schemas.payment_schemas import PaymentCreate
from app.core.fechas import hoy_bogota


class PaymentUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.payment_repo = PaymentRepository(db)
        self.gym_repo = GymRepository(db)
        self.audit_repo = AuditRepository(db)

    # ------------------------------------------------------------------
    # Fecha de corte (§3). Ninguno de estos métodos hace commit: se usan dentro de la
    # transacción del pago, la anulación, la reactivación o la aprobación de un plan.
    # ------------------------------------------------------------------
    def _tipo_inicio(self, gym: Gimnasio) -> str:
        primera = self.db.query(Suscripcion).filter(
            Suscripcion.gimnasio_id == gym.id
        ).order_by(Suscripcion.vigente_desde.asc(), Suscripcion.created_at.asc()).first()
        return primera.tipo_inicio if primera else "prueba"

    def _dias_prueba(self, gym: Gimnasio) -> int:
        return settings.DEFAULT_TRIAL_DAYS

    def calcular_corte(self, gym: Gimnasio) -> Optional[date]:
        """Fecha de corte derivada del historial completo de pagos (RNF-04)."""
        self.db.flush()
        pagos = [
            PagoCorte(p.fecha_pago, p.meses, bool(p.anulado), bool(p.fija_ancla))
            for p in self.payment_repo.list_for_cutting(gym.id)
        ]
        return CuttingDateCalculator.calcular(
            fecha_inicio=gym.fecha_inicio,
            tipo_inicio=self._tipo_inicio(gym),
            pagos=pagos,
            dias_prueba=self._dias_prueba(gym),
        )

    def recalcular_corte(self, gym: Gimnasio) -> Optional[date]:
        """Recalcula y guarda la fecha de corte en caché (sin commit)."""
        nueva = self.calcular_corte(gym)
        gym.fecha_corte = nueva
        self.db.flush()
        return nueva

    def validar_pago(self, fecha_pago: Optional[date], idempotency_key: str) -> None:
        """Validaciones previas a cualquier escritura (SA-RF-16 CA1, CA2)."""
        if fecha_pago and fecha_pago > hoy_bogota():
            raise BusinessRuleException(
                "La fecha del pago no puede ser posterior a hoy.", codigo="FECHA_PAGO_FUTURA"
            )
        if self.payment_repo.get_by_idempotency_key(idempotency_key):
            raise IdempotencyConflictException(idempotency_key)

    def agregar_pago(
        self,
        gym: Gimnasio,
        monto: Decimal,
        meses: int,
        fecha_pago: Optional[date],
        metodo: str,
        nota: Optional[str],
        idempotency_key: str,
        actor: UsuarioInterno,
    ) -> Tuple[Pago, Optional[date]]:
        """Registra el pago, decide si fija el ancla y recalcula el corte. Sin commit."""
        fecha_pago = fecha_pago or hoy_bogota()
        self.validar_pago(fecha_pago, idempotency_key)

        corte_vigente = self.calcular_corte(gym)
        fija_ancla = CuttingDateCalculator.pago_fija_ancla(corte_vigente, fecha_pago, gym.estado)

        payment = Pago(
            gimnasio_id=gym.id,
            monto=monto,
            meses=meses,
            fecha_pago=fecha_pago,
            metodo=metodo.strip(),
            nota=nota,
            anulado=False,
            fija_ancla=fija_ancla,
            idempotency_key=idempotency_key,
            registrado_por=actor.id
        )
        self.db.add(payment)
        self.db.flush()
        nueva_corte = self.recalcular_corte(gym)
        return payment, nueva_corte

    # ------------------------------------------------------------------
    def register_payment(
        self,
        gym_id: str,
        data: PaymentCreate,
        actor: UsuarioInterno
    ) -> Tuple[Pago, Optional[date]]:
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        if gym.estado == "cancelado":
            raise BusinessRuleException(
                "Un gimnasio cancelado no acepta pagos.", codigo="GIMNASIO_CANCELADO"
            )
        if gym.estado == "suspendido":
            raise BusinessRuleException(
                "Un gimnasio suspendido solo recibe pagos mediante la reactivación.",
                codigo="USAR_REACTIVACION",
            )
        self.validar_pago(data.fecha_pago, data.idempotency_key)
        try:
            estado_anterior = gym.estado
            payment, nueva_corte = self.agregar_pago(
                gym, data.monto, data.meses, data.fecha_pago, data.metodo, data.nota,
                data.idempotency_key, actor
            )

            # prueba → activo: el pago va en la misma operación y fija el ancla (§2.1, P-08).
            if gym.estado == "prueba":
                gym.estado = "activo"

            self.audit_repo.record_action(
                actor_id=actor.id,
                actor_nombre=actor.nombre,
                accion="REGISTRO_PAGO",
                entidad="pagos",
                entidad_id=payment.id,
                gimnasio_id=gym.id,
                detalle={
                    "monto": int(payment.monto),
                    "meses": payment.meses,
                    "metodo": payment.metodo,
                    "fecha_pago": str(payment.fecha_pago),
                    "fija_ancla": payment.fija_ancla,
                    "estado_anterior": estado_anterior,
                    "estado_nuevo": gym.estado,
                    "nueva_fecha_corte": str(nueva_corte)
                },
                commit=False
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        self.db.refresh(payment)
        return payment, nueva_corte

    def void_payment(
        self,
        payment_id: str,
        motivo_anulacion: str,
        actor: UsuarioInterno
    ) -> Tuple[Pago, Optional[date]]:
        """Anula el pago y recalcula la fecha de corte en la misma transacción (RF-18)."""
        payment = self.payment_repo.get_by_id(payment_id)
        if not payment:
            raise EntityNotFoundException("Pago", payment_id)

        if payment.anulado:
            raise EntityConflictException("Este pago ya ha sido anulado previamente.", codigo="PAGO_YA_ANULADO")

        if not motivo_anulacion or len(motivo_anulacion.strip()) < 5:
            raise BusinessRuleException(
                "El motivo de anulación es obligatorio y debe tener al menos 5 caracteres.",
                codigo="MOTIVO_REQUERIDO"
            )

        gym = self.gym_repo.get_by_id(payment.gimnasio_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", payment.gimnasio_id)

        try:
            payment.anulado = True
            payment.motivo_anulacion = motivo_anulacion.strip()
            payment.anulado_por = actor.id
            payment.anulado_en = datetime.now(timezone.utc)
            nueva_corte = self.recalcular_corte(gym)

            self.audit_repo.record_action(
                actor_id=actor.id,
                actor_nombre=actor.nombre,
                accion="ANULACION_PAGO",
                entidad="pagos",
                entidad_id=payment.id,
                gimnasio_id=gym.id,
                detalle={
                    "pago_id": payment.id,
                    "motivo": motivo_anulacion,
                    "nueva_fecha_corte": str(nueva_corte)
                },
                commit=False
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        self.db.refresh(payment)
        return payment, nueva_corte

    @staticmethod
    def advertencia_anulacion(payment: Pago, gym: Gimnasio, nueva_corte: Optional[date]) -> Optional[str]:
        """SA-RF-09 CA5: anular el pago que activó o reactivó no revierte el estado; se advierte."""
        if payment.fija_ancla and gym.estado == "activo":
            return (
                "El gimnasio sigue activo: anular este pago no revierte el estado. "
                f"Su fecha de corte quedó en {nueva_corte} y puede quedar bloqueado."
            )
        return None

    def update_subscription_price(
        self,
        gym_id: str,
        nuevo_valor: Decimal,
        vigente_desde: date,
        actor: UsuarioInterno
    ) -> Suscripcion:
        """
        Updates monthly subscription value without overwriting historical records (RF-14).
        """
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        # Close current active subscription
        current = self.db.query(Suscripcion).filter(
            Suscripcion.gimnasio_id == gym.id,
            Suscripcion.vigente_hasta.is_(None)
        ).first()

        if current:
            current.vigente_hasta = vigente_desde
            self.db.add(current)

        # Create new price record
        new_sub = Suscripcion(
            gimnasio_id=gym.id,
            valor_mensual=nuevo_valor,
            tipo_inicio=current.tipo_inicio if current else "cliente_activo",
            vigente_desde=vigente_desde,
            vigente_hasta=None
        )
        self.db.add(new_sub)
        self.db.commit()
        self.db.refresh(new_sub)

        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="ACTUALIZACION_PRECIO_SUSCRIPCION",
            entidad="suscripciones",
            entidad_id=new_sub.id,
            gimnasio_id=gym.id,
            detalle={
                "nuevo_valor_mensual": float(nuevo_valor),
                "vigente_desde": str(vigente_desde)
            }
        )

        return new_sub
