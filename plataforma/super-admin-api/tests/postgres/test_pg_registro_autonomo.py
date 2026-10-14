"""Tarea 7 · Registro autónomo con prueba gratis (SA-RF-34, contrato 3.2)."""
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.correo import AdaptadorCorreoLog
from app.core.fechas import hoy_bogota
from app.core.security import compute_sha256_hash, verify_password
from app.infrastructure.models.platform_models import Staff, Tenant
from app.infrastructure.models.superadmin_models import (
    Auditoria, CuentaJefe, Gimnasio, ProvisioningPaso, RegistroAutonomo, Suscripcion
)
from pg_utilidades import crear_gimnasio

P = "/api/v1/public"


@pytest.fixture(autouse=True)
def _bandeja_limpia():
    AdaptadorCorreoLog.bandeja.clear()
    yield


def _signup(client, correo=None, telefono=None, nombre=None, **extra):
    body = {
        "nombre_gimnasio": nombre or f"Gimnasio Autónomo {uuid.uuid4().hex[:6]}",
        "ciudad": "Medellín", "jefe_nombre": "Ana Dueña",
        "jefe_correo": correo or f"ana-{uuid.uuid4().hex[:6]}@pruebas.gymos.co",
        "telefono": telefono or f"3{uuid.uuid4().int % 10**9:09d}",
        "acepta_terminos": True,
    }
    body.update(extra)
    return client.post(f"{P}/signup", json=body)


def _ultimo_token(correo):
    msg = [m for m in AdaptadorCorreoLog.bandeja if m.destinatario == correo][-1]
    return re.search(r"/registro/confirmar/([A-Za-z0-9_\-]+)", msg.texto).group(1)


def test_planes_publicos_sin_autenticacion(pg_client):
    r = pg_client.get(f"{P}/plans")
    assert r.status_code == 200
    codigos = {p["codigo"] for p in r.json()}
    assert "prueba" in codigos and "anual" not in codigos  # anual está inactivo en la siembra


def test_subdomain_check_publico(pg_client, pg_headers):
    r = pg_client.get(f"{P}/subdomain-check", params={"nombre": "Gimnasio Ñandú Élite"})
    assert r.json() == {"subdominio_sugerido": "gimnasio-nandu-elite", "disponible": True}
    crear_gimnasio(pg_client, pg_headers, subdominio="gimnasio-nandu-elite")
    r = pg_client.get(f"{P}/subdomain-check", params={"nombre": "Gimnasio Ñandú Élite"})
    assert r.json()["disponible"] is False


def test_signup_siempre_202_y_token_guardado_como_hash(pg_client, pg_session, pg_headers):
    correo = f"ana-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    r = _signup(pg_client, correo=correo)
    assert r.status_code == 202
    token = _ultimo_token(correo)
    reg = pg_session.query(RegistroAutonomo).filter_by(jefe_correo=correo).one()
    assert reg.token_hash == compute_sha256_hash(token) and token not in reg.token_hash
    vigencia = reg.expira_en - reg.created_at
    assert timedelta(hours=23, minutes=59) < vigencia <= timedelta(hours=24, seconds=5)

    # Un correo que ya es Jefe recibe la misma respuesta (no se revela).
    gid = crear_gimnasio(pg_client, pg_headers)
    correo_jefe = pg_session.query(CuentaJefe).filter_by(gimnasio_id=gid).one().correo
    r2 = _signup(pg_client, correo=correo_jefe)
    assert r2.status_code == 202 and r2.json() == r.json()


def test_signup_valida_terminos(pg_client):
    assert _signup(pg_client, acepta_terminos=False).status_code == 422


def test_confirmar_crea_gimnasio_en_prueba_con_provisioning(pg_client, pg_session):
    correo = f"ana-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    nombre = f"Box Autónomo {uuid.uuid4().hex[:4]}"
    _signup(pg_client, correo=correo, nombre=nombre)
    token = _ultimo_token(correo)

    info = pg_client.get(f"{P}/signup/{token}")
    assert info.status_code == 200 and info.json()["valido"] is True and info.json()["nombre_gimnasio"] == nombre

    assert pg_client.post(f"{P}/signup/{token}/confirm", json={"password": "corta"}).status_code == 422
    r = pg_client.post(f"{P}/signup/{token}/confirm", json={"password": "MiClaveSegura2026"})
    assert r.status_code == 201, r.text
    sub = r.json()["subdominio"]
    assert r.json()["url_login"].startswith(f"https://{sub}.")

    gym = pg_session.query(Gimnasio).filter_by(subdominio=sub).one()
    assert gym.estado == "prueba" and gym.fecha_corte == hoy_bogota() + timedelta(days=5)
    sus = pg_session.query(Suscripcion).filter_by(gimnasio_id=gym.id).one()
    assert sus.plan.codigo == "prueba" and sus.tipo_inicio == "prueba"
    jefe = pg_session.query(Staff).filter_by(gimnasio_id=gym.gimnasio_id, rol="jefe").one()
    assert verify_password("MiClaveSegura2026", jefe.hash_password)
    assert pg_session.query(CuentaJefe).filter_by(gimnasio_id=gym.id).one().password_cambiada is True
    tenant = pg_session.get(Tenant, gym.gimnasio_id)
    assert "Efectivo" in tenant.metodos_pago and "Tarjeta" in tenant.metodos_pago
    assert pg_session.query(ProvisioningPaso).filter_by(gimnasio_id=gym.id, estado="completado").count() == 4
    aud = pg_session.query(Auditoria).filter_by(accion="REGISTRO_AUTONOMO_PRUEBA", gimnasio_id=gym.id).one()
    assert "MiClaveSegura2026" not in (aud.detalle if isinstance(aud.detalle, str) else str(aud.detalle))

    # Un solo uso.
    assert pg_client.get(f"{P}/signup/{token}").status_code == 410
    assert pg_client.post(f"{P}/signup/{token}/confirm", json={"password": "OtraClave2026"}).status_code == 410


def test_token_vencido_410_e_invalido_404(pg_client, pg_session):
    correo = f"ana-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    _signup(pg_client, correo=correo)
    token = _ultimo_token(correo)
    reg = pg_session.query(RegistroAutonomo).filter_by(jefe_correo=correo).one()
    reg.created_at = datetime.now(timezone.utc) - timedelta(hours=26)
    reg.expira_en = datetime.now(timezone.utc) - timedelta(hours=2)
    pg_session.commit()
    assert pg_client.get(f"{P}/signup/{token}").status_code == 410
    assert pg_client.post(f"{P}/signup/{token}/confirm", json={"password": "MiClaveSegura2026"}).status_code == 410
    assert pg_client.get(f"{P}/signup/token-que-no-existe").status_code == 404


def test_una_prueba_por_correo_y_por_telefono(pg_client):
    correo = f"ana-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    telefono = f"31{uuid.uuid4().int % 10**8:08d}"
    _signup(pg_client, correo=correo, telefono=telefono)
    assert pg_client.post(f"{P}/signup/{_ultimo_token(correo)}/confirm",
                          json={"password": "MiClaveSegura2026"}).status_code == 201

    # Mismo correo, otro teléfono.
    _signup(pg_client, correo=correo)
    r = pg_client.post(f"{P}/signup/{_ultimo_token(correo)}/confirm", json={"password": "MiClaveSegura2026"})
    assert r.status_code == 409 and r.json()["codigo"] == "PRUEBA_YA_USADA"

    # Otro correo, mismo teléfono escrito con indicativo y espacios.
    otro = f"beto-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    _signup(pg_client, correo=otro, telefono=f"+57 {telefono[:3]} {telefono[3:]}")
    r = pg_client.post(f"{P}/signup/{_ultimo_token(otro)}/confirm", json={"password": "MiClaveSegura2026"})
    assert r.status_code == 409 and r.json()["codigo"] == "PRUEBA_YA_USADA"


def test_subdominio_ocupado_recibe_sufijo(pg_client, pg_headers):
    base = f"crossfit-sur-{uuid.uuid4().hex[:4]}"
    crear_gimnasio(pg_client, pg_headers, subdominio=base)
    correo = f"ana-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    _signup(pg_client, correo=correo, nombre=base.replace("-", " "))
    r = pg_client.post(f"{P}/signup/{_ultimo_token(correo)}/confirm", json={"password": "MiClaveSegura2026"})
    assert r.status_code == 201 and r.json()["subdominio"] == f"{base}-2"
