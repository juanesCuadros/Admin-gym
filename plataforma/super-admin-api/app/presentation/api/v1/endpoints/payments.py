from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.dependencies import get_current_admin_user
from app.infrastructure.repositories.payment_repository import PaymentRepository
from app.application.use_cases.payment_use_cases import PaymentUseCases
from app.presentation.schemas.payment_schemas import (
    PaymentCreate, PaymentVoidRequest, PaymentResponse, SubscriptionUpdatePrice
)
from app.presentation.schemas.gym_schemas import SubscriptionResponse

router = APIRouter(tags=["Cobros y Suscripciones"])

@router.get("/admin/gyms/{gym_id}/payments", response_model=List[PaymentResponse], summary="Listar historial de pagos de un gimnasio")
def list_gym_payments(
    gym_id: str,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """Obtiene el historial de pagos de un gimnasio (tanto vigentes como anulados)."""
    repo = PaymentRepository(db)
    payments = repo.list_by_gym(gym_id)
    return [
        PaymentResponse(
            id=p.id,
            gimnasio_id=p.gimnasio_id,
            monto=float(p.monto),
            meses=p.meses,
            fecha_pago=p.fecha_pago,
            metodo=p.metodo,
            nota=p.nota,
            anulado=p.anulado,
            motivo_anulacion=p.motivo_anulacion,
            anulado_en=p.anulado_en,
            idempotency_key=p.idempotency_key,
            created_at=p.created_at
        )
        for p in payments
    ]

@router.post("/admin/gyms/{gym_id}/payments", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED, summary="Registrar pago y derivar fecha de corte")
def register_payment(
    gym_id: str,
    data: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-16 / RF-17: Registrar un pago: monto, meses cubiertos, fecha, método (texto libre) y nota.
    Calcula y actualiza la fecha de corte resultante, derivada estrictamente del historial de pagos (RNF-04).
    Exige idempotency_key para evitar pagos duplicados por reintentos de red.
    """
    use_cases = PaymentUseCases(db)
    payment, nueva_corte = use_cases.register_payment(gym_id, data, actor=current_user)

    return PaymentResponse(
        id=payment.id,
        gimnasio_id=payment.gimnasio_id,
        monto=float(payment.monto),
        meses=payment.meses,
        fecha_pago=payment.fecha_pago,
        metodo=payment.metodo,
        nota=payment.nota,
        anulado=payment.anulado,
        motivo_anulacion=payment.motivo_anulacion,
        anulado_en=payment.anulado_en,
        idempotency_key=payment.idempotency_key,
        created_at=payment.created_at,
        nueva_fecha_corte=nueva_corte
    )

@router.post("/admin/payments/{payment_id}/void", response_model=PaymentResponse, summary="Anular pago y recalcular fecha de corte")
def void_payment(
    payment_id: str,
    data: PaymentVoidRequest,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-18: Anular un pago con motivo; recalcula la fecha de corte resultante
    desde el historial de pagos no anulados (RNF-04).
    """
    use_cases = PaymentUseCases(db)
    payment, nueva_corte = use_cases.void_payment(payment_id, data.motivo_anulacion, actor=current_user)

    return PaymentResponse(
        id=payment.id,
        gimnasio_id=payment.gimnasio_id,
        monto=float(payment.monto),
        meses=payment.meses,
        fecha_pago=payment.fecha_pago,
        metodo=payment.metodo,
        nota=payment.nota,
        anulado=payment.anulado,
        motivo_anulacion=payment.motivo_anulacion,
        anulado_en=payment.anulado_en,
        idempotency_key=payment.idempotency_key,
        created_at=payment.created_at,
        nueva_fecha_corte=nueva_corte
    )

@router.post("/admin/gyms/{gym_id}/subscriptions/price", response_model=SubscriptionResponse, summary="Actualizar precio mensual de la suscripción")
def update_subscription_price(
    gym_id: str,
    data: SubscriptionUpdatePrice,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-14: Mantener el histórico de la suscripción (valor mensual con vigencia,
    sin sobrescribir el valor anterior).
    """
    use_cases = PaymentUseCases(db)
    new_sub = use_cases.update_subscription_price(
        gym_id=gym_id,
        nuevo_valor=data.nuevo_valor_mensual,
        vigente_desde=data.vigente_desde,
        actor=current_user
    )
    return SubscriptionResponse(
        id=new_sub.id,
        valor_mensual=float(new_sub.valor_mensual),
        tipo_inicio=new_sub.tipo_inicio,
        vigente_desde=new_sub.vigente_desde,
        vigente_hasta=new_sub.vigente_hasta
    )
