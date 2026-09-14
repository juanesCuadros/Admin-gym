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
from app.domain.services.cutting_date_calculator import CuttingDateCalculator
from app.core.exceptions import (
    EntityNotFoundException, BusinessRuleException,
    IdempotencyConflictException
)
from app.presentation.schemas.payment_schemas import PaymentCreate

class PaymentUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.payment_repo = PaymentRepository(db)
        self.gym_repo = GymRepository(db)
        self.audit_repo = AuditRepository(db)

    def _recalculate_gym_cutting_date(self, gym: Gimnasio) -> Optional[date]:
        """
        Derives fecha_corte purely from the historical non-voided payments (RNF-04).
        """
        active_payments = self.payment_repo.list_active_by_gym(gym.id)
        months_list = [p.meses for p in active_payments]

        latest_subscription = self.db.query(Suscripcion).filter(
            Suscripcion.gimnasio_id == gym.id
        ).order_by(Suscripcion.vigente_desde.desc()).first()

        tipo_inicio = latest_subscription.tipo_inicio if latest_subscription else "prueba"

        nueva_fecha_corte = CuttingDateCalculator.calculate_cutting_date(
            fecha_inicio=gym.fecha_inicio,
            tipo_inicio=tipo_inicio,
            pagos_meses=months_list
        )

        gym.fecha_corte = nueva_fecha_corte
        self.db.commit()
        self.db.refresh(gym)
        return nueva_fecha_corte

    def register_payment(
        self,
        gym_id: str,
        data: PaymentCreate,
        actor: UsuarioInterno
    ) -> Tuple[Pago, Optional[date]]:
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        # 1. Idempotency Check (RNF-04)
        existing = self.payment_repo.get_by_idempotency_key(data.idempotency_key)
        if existing:
            raise IdempotencyConflictException(data.idempotency_key)

        # 2. Create Payment Record
        payment = Pago(
            gimnasio_id=gym.id,
            monto=data.monto,
            meses=data.meses,
            fecha_pago=data.fecha_pago or date.today(),
            metodo=data.metodo.strip(),
            nota=data.nota,
            anulado=False,
            idempotency_key=data.idempotency_key,
            registrado_por=actor.id
        )
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)

        # 3. Recalculate cutting date derived from payment history (RF-17 / RNF-04)
        nueva_corte = self._recalculate_gym_cutting_date(gym)

        # If gym was in trial or suspended, automatically activate upon payment
        if gym.estado in ["prueba", "suspendido"]:
            gym.estado = "activo"
            self.db.commit()
            self.db.refresh(gym)

        # 4. Audit Log
        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="REGISTRO_PAGO",
            entidad="pagos",
            entidad_id=payment.id,
            gimnasio_id=gym.id,
            detalle={
                "monto": float(payment.monto),
                "meses": payment.meses,
                "metodo": payment.metodo,
                "nueva_fecha_corte": str(nueva_corte)
            }
        )

        return payment, nueva_corte

    def void_payment(
        self,
        payment_id: str,
        motivo_anulacion: str,
        actor: UsuarioInterno
    ) -> Tuple[Pago, Optional[date]]:
        """Voids payment and recalculates cutting date from remaining history (RF-18)."""
        payment = self.payment_repo.get_by_id(payment_id)
        if not payment:
            raise EntityNotFoundException("Pago", payment_id)

        if payment.anulado:
            raise BusinessRuleException("Este pago ya ha sido anulado previamente.")

        if not motivo_anulacion or len(motivo_anulacion.strip()) < 5:
            raise BusinessRuleException("El motivo de anulación es obligatorio y debe tener al menos 5 caracteres.")

        gym = self.gym_repo.get_by_id(payment.gimnasio_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", payment.gimnasio_id)

        # Mark voided
        payment.anulado = True
        payment.motivo_anulacion = motivo_anulacion.strip()
        payment.anulado_por = actor.id
        payment.anulado_en = datetime.now(timezone.utc)
        self.db.commit()

        # Recalculate cutting date derived strictly from remaining active payments
        nueva_corte = self._recalculate_gym_cutting_date(gym)

        # Audit Log
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
            }
        )

        return payment, nueva_corte

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
