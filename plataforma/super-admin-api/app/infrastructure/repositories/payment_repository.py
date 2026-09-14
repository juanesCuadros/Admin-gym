from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session
from app.infrastructure.models.superadmin_models import Pago

class PaymentRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, payment_id: str) -> Optional[Pago]:
        return self.db.query(Pago).filter(Pago.id == payment_id).first()

    def get_by_idempotency_key(self, idempotency_key: str) -> Optional[Pago]:
        return self.db.query(Pago).filter(Pago.idempotency_key == idempotency_key).first()

    def list_by_gym(self, gym_id: str) -> List[Pago]:
        return self.db.query(Pago).filter(
            Pago.gimnasio_id == gym_id
        ).order_by(Pago.fecha_pago.desc(), Pago.created_at.desc()).all()

    def list_active_by_gym(self, gym_id: str) -> List[Pago]:
        return self.db.query(Pago).filter(
            Pago.gimnasio_id == gym_id,
            Pago.anulado.is_(False)
        ).order_by(Pago.fecha_pago.asc()).all()

    def save(self, payment: Pago) -> Pago:
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)
        return payment
