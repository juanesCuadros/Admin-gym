import pytest

from app.infrastructure.models.superadmin_models import PlanSuscripcion

# Ids fijos de los planes sembrados en la BD SQLite en memoria (la 003 los siembra en PostgreSQL).
PLAN_PRUEBA = "plan-prueba-sqlite"
PLAN_MENSUAL = "plan-mensual-sqlite"


@pytest.fixture(autouse=True)
def planes_base(db_session):
    # La BD SQLite en memoria no siempre revierte entre pruebas: la siembra es idempotente.
    for plan in (
        PlanSuscripcion(id=PLAN_PRUEBA, codigo="prueba", nombre="Prueba gratis", tipo="prueba",
                        precio=0, dias_prueba=5, activo=True, orden=0),
        PlanSuscripcion(id=PLAN_MENSUAL, codigo="mensual", nombre="Mensual", tipo="pago",
                        precio=150000, duracion_meses=1, activo=True, orden=1),
    ):
        db_session.merge(plan)
    db_session.commit()
    return {"prueba": PLAN_PRUEBA, "mensual": PLAN_MENSUAL}
