from datetime import date, datetime, timezone, timedelta
from typing import Optional, List, Tuple, Dict, Any
from decimal import Decimal
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, and_, case, text, true, exists
from app.infrastructure.models.superadmin_models import (
    Gimnasio, CuentaJefe, Suscripcion, Pago, EmisionCredenciales, SolicitudPlan
)
from app.infrastructure.models.platform_models import Tenant, Staff
from app.core.fechas import hoy_bogota, fecha_bogota
from app.domain.services.ciclo_de_vida import (
    DIAS_AVISO_PRUEBA, DIAS_RETENCION_CANCELADO, FILTROS_ESTADO_CALCULADO
)

# Estado calculado: la única fuente es platform.estado_suscripcion() (migración 001; EXECUTE para
# gymos_superadmin en la 030). Aquí NO se replica la regla de §2.2: solo se lee lo que devuelve.
# En SQLite (suite de pruebas en memoria) la función no existe y los campos calculados quedan en None.
_SIN_ESTADO = {"estado_calculado": None, "dias_restantes": None, "motivo_bloqueo": None}


class GymRepository:
    def __init__(self, db: Session):
        self.db = db

    def _es_postgres(self) -> bool:
        return self.db.get_bind().dialect.name == "postgresql"

    @staticmethod
    def _funcion_estado():
        return func.platform.estado_suscripcion(Gimnasio.gimnasio_id).table_valued(
            "estado_calculado", "dias_restantes", "motivo_bloqueo", name="es"
        ).lateral()

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

    def estado_calculado(self, gym: Gimnasio) -> Dict[str, Any]:
        """Estado calculado de un gimnasio leído de platform.estado_suscripcion()."""
        if not self._es_postgres():
            return dict(_SIN_ESTADO)
        self.db.flush()
        fila = self.db.execute(
            text("SELECT estado_calculado, dias_restantes, motivo_bloqueo "
                 "FROM platform.estado_suscripcion(CAST(:gid AS uuid))"),
            {"gid": gym.gimnasio_id},
        ).mappings().first()
        return dict(fila) if fila else dict(_SIN_ESTADO)

    def list_gyms(
        self,
        search: Optional[str] = None,
        estado: Optional[str] = None,
        order_by: str = "urgency",
        limit: int = 50,
        offset: int = 0,
        estado_calculado: Optional[str] = None,
    ) -> Tuple[List[Tuple[Gimnasio, Dict[str, Any]]], int]:
        """Lista con filtros y orden de urgencia (SA-RF-02, SA-RF-03, contrato 3.3)."""
        pg = self._es_postgres()
        if pg:
            es = self._funcion_estado()
            query = self.db.query(
                Gimnasio, es.c.estado_calculado, es.c.dias_restantes, es.c.motivo_bloqueo
            ).outerjoin(es, true())
        else:
            es = None
            query = self.db.query(Gimnasio)

        query = query.options(
            joinedload(Gimnasio.cuenta_jefe),
            joinedload(Gimnasio.suscripciones)
        ).filter(Gimnasio.deleted_at.is_(None))

        if estado:
            query = query.filter(Gimnasio.estado == estado)

        if estado_calculado:
            if not pg:
                return [], 0
            # Los cancelados no participan del ciclo de cobro: no entran en los filtros calculados.
            query = query.filter(Gimnasio.estado != "cancelado")
            if estado_calculado == "prueba_por_vencer":
                query = query.filter(
                    Gimnasio.estado == "prueba",
                    es.c.dias_restantes.between(0, DIAS_AVISO_PRUEBA),
                )
            else:
                query = query.filter(es.c.estado_calculado == estado_calculado)

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
        today = hoy_bogota()

        if order_by == "urgency":
            if pg:
                # SA-RF-02 CA1: bloqueados → en gracia → pruebas por vencer → por vencer → resto,
                # por días restantes ascendente. Los cancelados van al final.
                urgencia = case(
                    (Gimnasio.estado == "cancelado", 6),
                    (es.c.estado_calculado == "bloqueado", 1),
                    (es.c.estado_calculado == "en_gracia", 2),
                    (and_(Gimnasio.estado == "prueba",
                          es.c.dias_restantes.between(0, DIAS_AVISO_PRUEBA)), 3),
                    (es.c.estado_calculado == "por_vencer", 4),
                    else_=5
                )
                query = query.order_by(urgencia.asc(), es.c.dias_restantes.asc().nullslast(), Gimnasio.nombre.asc())
            else:
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

        filas = query.offset(offset).limit(limit).all()
        if pg:
            items = [
                (g, {"estado_calculado": ec, "dias_restantes": dr, "motivo_bloqueo": mb})
                for g, ec, dr, mb in filas
            ]
        else:
            items = [(g, dict(_SIN_ESTADO)) for g in filas]
        return items, total

    def listos_para_eliminar(self) -> List[Gimnasio]:
        """Cancelados hace 30 días o más, aún sin eliminar (§2.4, SA-RF-01 CA5)."""
        hoy = hoy_bogota()
        cancelados = self.db.query(Gimnasio).filter(
            Gimnasio.deleted_at.is_(None),
            Gimnasio.estado == "cancelado",
            Gimnasio.fecha_cancelacion.isnot(None),
        ).all()
        return [
            g for g in cancelados
            if (hoy - fecha_bogota(g.fecha_cancelacion)).days >= DIAS_RETENCION_CANCELADO
        ]

    def get_dashboard_metrics(self) -> Dict[str, Any]:
        """Métricas del Inicio (SA-RF-01, contrato 3.3)."""
        today = hoy_bogota()

        counts = self.db.query(
            Gimnasio.estado,
            func.count(Gimnasio.id)
        ).filter(Gimnasio.deleted_at.is_(None)).group_by(Gimnasio.estado).all()

        status_map = {st: 0 for st in ["prueba", "activo", "suspendido", "cancelado"]}
        for st, cnt in counts:
            if st in status_map:
                status_map[st] = cnt

        # Estados calculados: se cuentan las filas que devuelve la función de la BD.
        calculados = {"por_vencer": 0, "en_gracia": 0, "bloqueados": 0, "pruebas_por_vencer": 0}
        if self._es_postgres():
            es = self._funcion_estado()
            filas = self.db.query(
                Gimnasio.estado, es.c.estado_calculado, es.c.dias_restantes
            ).outerjoin(es, true()).filter(
                Gimnasio.deleted_at.is_(None), Gimnasio.estado != "cancelado"
            ).all()
            for estado_guardado, ec, dias in filas:
                if ec == "por_vencer":
                    calculados["por_vencer"] += 1
                elif ec == "en_gracia":
                    calculados["en_gracia"] += 1
                elif ec == "bloqueado":
                    calculados["bloqueados"] += 1
                if estado_guardado == "prueba" and dias is not None and 0 <= dias <= DIAS_AVISO_PRUEBA:
                    calculados["pruebas_por_vencer"] += 1

        # Ingresos del mes (Bogotá) = Σ pagos no anulados con fecha_pago dentro del mes (SA-RF-01 CA2).
        first_day_month = date(today.year, today.month, 1)
        monthly_revenue = self.db.query(func.sum(Pago.monto)).filter(
            Pago.anulado.is_(False),
            Pago.fecha_pago >= first_day_month,
            Pago.fecha_pago <= today,
        ).scalar() or Decimal("0.00")

        mrr = self.db.query(func.sum(Suscripcion.valor_mensual)).join(
            Gimnasio, Gimnasio.id == Suscripcion.gimnasio_id
        ).filter(
            Gimnasio.estado == "activo",
            Gimnasio.deleted_at.is_(None),
            Suscripcion.vigente_hasta.is_(None)
        ).scalar() or Decimal("0.00")

        solicitudes_pendientes = self.db.query(func.count(SolicitudPlan.id)).join(
            Gimnasio, Gimnasio.id == SolicitudPlan.gimnasio_id
        ).filter(
            SolicitudPlan.estado == "pendiente", Gimnasio.deleted_at.is_(None)
        ).scalar() or 0

        # Pruebas nuevas: gimnasios creados en los últimos 7 días que iniciaron en prueba
        # (alta asistida o registro autónomo).
        hace_7_dias = datetime.now(timezone.utc) - timedelta(days=7)
        pruebas_nuevas = self.db.query(func.count(Gimnasio.id)).filter(
            Gimnasio.deleted_at.is_(None),
            Gimnasio.created_at >= hace_7_dias,
            exists().where(and_(
                Suscripcion.gimnasio_id == Gimnasio.id, Suscripcion.tipo_inicio == "prueba"
            )),
        ).scalar() or 0

        return {
            "total_gimnasios": sum(status_map.values()),
            "por_estado": status_map,
            # Heredado: vencidos = en gracia + bloqueados (calculados), sin cancelados.
            "vencidos": calculados["en_gracia"] + calculados["bloqueados"],
            "por_vencer": calculados["por_vencer"],
            "pruebas_por_vencer": calculados["pruebas_por_vencer"],
            "en_gracia": calculados["en_gracia"],
            "bloqueados": calculados["bloqueados"],
            "listos_para_eliminar": len(self.listos_para_eliminar()),
            "solicitudes_plan_pendientes": solicitudes_pendientes,
            "pruebas_nuevas_7d": pruebas_nuevas,
            "ingresos_mes": float(monthly_revenue),
            "mrr_estimado": float(mrr),
            "total_miembros_global": 0  # To be connected when platform deportistas are queried
        }

    def save(self, gym: Gimnasio) -> Gimnasio:
        self.db.add(gym)
        self.db.commit()
        self.db.refresh(gym)
        return gym
