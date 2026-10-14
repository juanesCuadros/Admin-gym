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
