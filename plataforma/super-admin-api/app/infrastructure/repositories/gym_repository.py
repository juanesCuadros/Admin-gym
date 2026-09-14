from datetime import date, datetime, timezone, timedelta
from typing import Optional, List, Tuple, Dict, Any
from decimal import Decimal
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, desc, asc, case
from app.infrastructure.models.superadmin_models import Gimnasio, CuentaJefe, Suscripcion, Pago, EmisionCredenciales
from app.infrastructure.models.platform_models import Tenant, Staff

class GymRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, gym_id: str) -> Optional[Gimnasio]:
        return self.db.query(Gimnasio).options(
            joinedload(Gimnasio.cuenta_jefe),
            joinedload(Gimnasio.suscripciones),
            joinedload(Gimnasio.pagos),
            joinedload(Gimnasio.credenciales)
        ).filter(
            Gimnasio.id == gym_id,
            Gimnasio.deleted_at.is_(None)
        ).first()

    def get_by_subdomain(self, subdomain: str) -> Optional[Gimnasio]:
        return self.db.query(Gimnasio).filter(
            func.lower(Gimnasio.subdominio) == subdomain.strip().lower(),
            Gimnasio.deleted_at.is_(None)
        ).first()

    def list_gyms(
        self,
        search: Optional[str] = None,
        estado: Optional[str] = None,
        order_by: str = "urgency",
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[Gimnasio], int]:
        """Lists gyms with filtering and priority ordering (RF-02, RF-03)."""
        query = self.db.query(Gimnasio).options(
            joinedload(Gimnasio.cuenta_jefe),
            joinedload(Gimnasio.suscripciones)
        ).filter(Gimnasio.deleted_at.is_(None))

        if estado:
            query = query.filter(Gimnasio.estado == estado)

        if search:
            search_pattern = f"%{search.strip().lower()}%"
            query = query.filter(
                or_(
                    func.lower(Gimnasio.nombre).like(search_pattern),
                    func.lower(Gimnasio.subdominio).like(search_pattern),
                    func.lower(Gimnasio.nit).like(search_pattern),
                    func.lower(Gimnasio.ciudad).like(search_pattern)
                )
            )

        total = query.count()
        today = date.today()

        # Urgency ordering:
        # 1. Suspended or Expired (fecha_corte < today)
        # 2. Expiring within 5 days
        # 3. Active
        # 4. Trials
        # 5. Cancelled
        if order_by == "urgency":
            urgency_score = case(
                (Gimnasio.estado == "suspendido", 1),
                (Gimnasio.fecha_corte < today, 2),
                (Gimnasio.fecha_corte <= today + timedelta(days=5), 3),
                (Gimnasio.estado == "activo", 4),
                (Gimnasio.estado == "prueba", 5),
                else_=6
            )
            query = query.order_by(urgency_score.asc(), Gimnasio.fecha_corte.asc().nullslast())
        elif order_by == "nombre":
            query = query.order_by(Gimnasio.nombre.asc())
        elif order_by == "fecha_corte":
            query = query.order_by(Gimnasio.fecha_corte.asc().nullslast())
        else:
            query = query.order_by(Gimnasio.created_at.desc())

        items = query.offset(offset).limit(limit).all()
        return items, total

    def get_dashboard_metrics(self) -> Dict[str, Any]:
        """Calculates global executive metrics for RF-01."""
        today = date.today()
        five_days_ahead = today + timedelta(days=5)

        # Count by status
        counts = self.db.query(
            Gimnasio.estado,
            func.count(Gimnasio.id)
        ).filter(Gimnasio.deleted_at.is_(None)).group_by(Gimnasio.estado).all()

        status_map = {st: 0 for st in ["prueba", "activo", "suspendido", "cancelado"]}
        for st, cnt in counts:
            if st in status_map:
                status_map[st] = cnt

        # Vencidos: active or trial with fecha_corte < today
        vencidos_count = self.db.query(func.count(Gimnasio.id)).filter(
            Gimnasio.deleted_at.is_(None),
            Gimnasio.estado.in_(["activo", "prueba", "suspendido"]),
            Gimnasio.fecha_corte < today
        ).scalar() or 0

        # Por vencer: fecha_corte between today and today + 5 days
        por_vencer_count = self.db.query(func.count(Gimnasio.id)).filter(
            Gimnasio.deleted_at.is_(None),
            Gimnasio.estado.in_(["activo", "prueba"]),
            Gimnasio.fecha_corte >= today,
            Gimnasio.fecha_corte <= five_days_ahead
        ).scalar() or 0

        # Pruebas por vencer
        pruebas_por_vencer = self.db.query(func.count(Gimnasio.id)).filter(
            Gimnasio.deleted_at.is_(None),
            Gimnasio.estado == "prueba",
            Gimnasio.fecha_corte <= five_days_ahead
        ).scalar() or 0

        # Current month subscription revenue (from non-voided payments this month)
        first_day_month = date(today.year, today.month, 1)
        monthly_revenue = self.db.query(func.sum(Pago.monto)).filter(
            Pago.anulado.is_(False),
            Pago.fecha_pago >= first_day_month
        ).scalar() or Decimal("0.00")

        # MRR (Sum of latest active subscriptions)
        mrr = self.db.query(func.sum(Suscripcion.valor_mensual)).join(
            Gimnasio, Gimnasio.id == Suscripcion.gimnasio_id
        ).filter(
            Gimnasio.estado == "activo",
            Gimnasio.deleted_at.is_(None),
            Suscripcion.vigente_hasta.is_(None)
        ).scalar() or Decimal("0.00")

        total_gyms = sum(status_map.values())

        return {
            "total_gimnasios": total_gyms,
            "por_estado": status_map,
            "vencidos": vencidos_count,
            "por_vencer": por_vencer_count,
            "pruebas_por_vencer": pruebas_por_vencer,
            "ingresos_mes": float(monthly_revenue),
            "mrr_estimado": float(mrr),
            "total_miembros_global": 0  # To be connected when platform deportistas are queried
        }

    def save(self, gym: Gimnasio) -> Gimnasio:
        self.db.add(gym)
        self.db.commit()
        self.db.refresh(gym)
        return gym
