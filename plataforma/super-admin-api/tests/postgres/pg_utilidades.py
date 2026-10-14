"""Ayudas para las pruebas contra PostgreSQL: crean datos por la API real, sin atajos."""
import contextlib
import uuid
from datetime import date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


@contextlib.contextmanager
def como_superusuario(session: Session):
    """Ejecuta un bloque con el rol de superusuario dentro de la misma transacción
    (para sembrar datos del tenant que el SA no puede escribir)."""
    session.flush()
    session.execute(text("RESET ROLE"))
    try:
        yield session
    finally:
        session.execute(text("SET LOCAL ROLE gymos_superadmin"))


def plan_id(client, headers, codigo: str) -> str:
    """Id del plan sembrado por la migración 003; lo activa si está inactivo (dentro de la transacción)."""
    planes = client.get("/api/v1/admin/plans", headers=headers).json()
    plan = next(p for p in planes if p["codigo"] == codigo)
    if not plan["activo"]:
        r = client.patch(f"/api/v1/admin/plans/{plan['id']}/status", json={"activo": True}, headers=headers)
        assert r.status_code == 200, r.text
    return plan["id"]


def crear_gimnasio(client, headers, tipo: str = "prueba", nombre: Optional[str] = None, **extra) -> str:
    sufijo = uuid.uuid4().hex[:8]
    plan = plan_id(client, headers, "prueba" if tipo == "prueba" else "mensual")
    payload = {
        "nombre": nombre or f"Gimnasio Prueba {sufijo}",
        "subdominio": f"gym-{sufijo}",
        "ciudad": "Bogotá",
        "jefe": {"nombre": "Jefe de Pruebas", "correo": f"jefe-{sufijo}@pruebas.gymos.co"},
        "suscripcion": {"valor_mensual": 150000, "tipo_inicio": tipo, "plan_id": plan},
    }
    payload.update(extra)
    r = client.post("/api/v1/admin/gyms", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["gimnasio"]["id"]


def pagar(client, headers, gym_id: str, meses: int, fecha_pago: date, clave: Optional[str] = None, monto: int = 150000):
    return client.post(
        f"/api/v1/admin/gyms/{gym_id}/payments",
        json={
            "monto": monto * meses,
            "meses": meses,
            "fecha_pago": fecha_pago.isoformat(),
            "metodo": "Transferencia",
            "idempotency_key": clave or f"idem-{uuid.uuid4()}",
        },
        headers=headers,
    )


def sembrar_datos_tenant(session: Session, tenant_id: str) -> dict:
    """Crea datos reales del gimnasio (como superusuario, igual que los crearía el Sistema Web):
    un plan, un deportista, su membresía, un turno de caja con un pago y un ingreso. Incluye FK
    RESTRICT internas (membresias → planes, pagos_membresia → turnos_caja) a propósito."""
    p = {"g": tenant_id}
    with como_superusuario(session):
        q = lambda sql, **kw: session.execute(text(sql), {**p, **kw}).scalar()
        plan = q("INSERT INTO platform.planes (gimnasio_id, nombre, precio, duracion_dias, tipo) "
                 "VALUES (CAST(:g AS uuid), 'Mensualidad', 90000, 30, 'individual') RETURNING id")
        dep = q("INSERT INTO platform.deportistas (gimnasio_id, documento, nombre, telefono) "
                "VALUES (CAST(:g AS uuid), '1020304050', 'Camila Ñúñez', '3001112233') RETURNING id")
        mem = q("INSERT INTO platform.membresias (gimnasio_id, deportista_id, plan_id, fecha_vencimiento) "
                "VALUES (CAST(:g AS uuid), CAST(:d AS uuid), CAST(:pl AS uuid), current_date + 30) RETURNING id",
                d=dep, pl=plan)
        staff = q("SELECT id FROM platform.staff WHERE gimnasio_id = CAST(:g AS uuid) AND rol = 'jefe'")
        turno = q("INSERT INTO platform.turnos_caja (gimnasio_id, staff_id) "
                  "VALUES (CAST(:g AS uuid), CAST(:s AS uuid)) RETURNING id", s=staff)
        q("INSERT INTO platform.pagos_membresia (gimnasio_id, turno_id, membresia_id, monto, metodo, tipo_medio, "
          "dias_agregados, idempotency_key) VALUES (CAST(:g AS uuid), CAST(:t AS uuid), CAST(:m AS uuid), 90000, "
          "'Efectivo', 'efectivo', 30, :k) RETURNING id", t=turno, m=mem, k=f"pm-{uuid.uuid4()}")
        q("INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado) "
          "VALUES (CAST(:g AS uuid), CAST(:d AS uuid), 'ingreso', 'manual', 'abrio') RETURNING id", d=dep)
    return {"deportista_id": dep, "membresia_id": mem}


def contar_filas_tenant(session: Session, tenant_id: str) -> int:
    """Total de filas de platform con ese gimnasio_id, más la fila de platform.tenant."""
    with como_superusuario(session):
        tablas = session.execute(text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "JOIN pg_attribute a ON a.attrelid = c.oid WHERE n.nspname = 'platform' AND c.relkind = 'r' "
            "AND a.attname = 'gimnasio_id' AND NOT a.attisdropped")).scalars().all()
        total = sum(session.execute(text(f"SELECT count(*) FROM platform.{t} WHERE gimnasio_id = CAST(:g AS uuid)"),
                                    {"g": tenant_id}).scalar() for t in tablas)
        total += session.execute(text("SELECT count(*) FROM platform.tenant WHERE id = CAST(:g AS uuid)"),
                                 {"g": tenant_id}).scalar()
    return total
