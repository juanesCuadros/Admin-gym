"""Ayudas para las pruebas contra PostgreSQL: crean datos por la API real, sin atajos."""
import uuid
from datetime import date
from typing import Optional


def crear_gimnasio(client, headers, tipo: str = "prueba", nombre: Optional[str] = None, **extra) -> str:
    sufijo = uuid.uuid4().hex[:8]
    payload = {
        "nombre": nombre or f"Gimnasio Prueba {sufijo}",
        "subdominio": f"gym-{sufijo}",
        "ciudad": "Bogotá",
        "jefe": {"nombre": "Jefe de Pruebas", "correo": f"jefe-{sufijo}@pruebas.gymos.co"},
        "suscripcion": {"valor_mensual": 150000, "tipo_inicio": tipo},
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
