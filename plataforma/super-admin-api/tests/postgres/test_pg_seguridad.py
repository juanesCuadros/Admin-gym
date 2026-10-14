"""Tarea 9 · Seguridad del SA: SA-RF-00.4 (mensaje genérico en bloqueo), SA-RF-00.2 (token de 1 h)
y SA-RF-05 (subdominio de 3 a 63 caracteres, palabras reservadas y unicidad en BD)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.application.use_cases.auth_use_cases import AuthUseCases
from app.core.config import settings
from app.core.security import compute_sha256_hash
from app.infrastructure.models.superadmin_models import Gimnasio, TokenRecuperacion
from app.infrastructure.repositories.gym_repository import GymRepository
from pg_utilidades import crear_gimnasio, plan_id

LOGIN = "/api/v1/auth/login"


def _alta(client, headers, subdominio):
    sufijo = uuid.uuid4().hex[:6]
    return client.post("/api/v1/admin/gyms", headers=headers, json={
        "nombre": "Gimnasio de Pruebas", "subdominio": subdominio,
        "jefe": {"nombre": "Jefe", "correo": f"j-{sufijo}@pruebas.gymos.co"},
        "suscripcion": {"valor_mensual": 0, "tipo_inicio": "prueba", "plan_id": plan_id(client, headers, "prueba")}})


def test_bloqueo_responde_igual_que_credenciales_invalidas(pg_client, pg_admin):
    malo = {"correo": pg_admin.correo, "password": "ClaveIncorrecta1"}
    for _ in range(settings.MAX_LOGIN_ATTEMPTS):
        assert pg_client.post(LOGIN, json=malo).status_code == 401
    invalida = pg_client.post(LOGIN, json=malo)
    bloqueada = pg_client.post(LOGIN, json={"correo": pg_admin.correo, "password": "ClaveSegura2026!"})
    assert bloqueada.status_code == invalida.status_code == 401
    assert bloqueada.json()["codigo"] == invalida.json()["codigo"] == "CREDENCIALES_INVALIDAS"
    assert bloqueada.json()["mensaje"] == invalida.json()["mensaje"]
    inexistente = pg_client.post(LOGIN, json={"correo": "nadie@gymos.co", "password": "ClaveCualquiera2026"})
    assert inexistente.json()["mensaje"] == bloqueada.json()["mensaje"]


def test_ingreso_exitoso_reinicia_el_contador(pg_client, pg_admin):
    malo = {"correo": pg_admin.correo, "password": "ClaveIncorrecta1"}
    bueno = {"correo": pg_admin.correo, "password": "ClaveSegura2026!"}
    for _ in range(settings.MAX_LOGIN_ATTEMPTS - 1):
        pg_client.post(LOGIN, json=malo)
    assert pg_client.post(LOGIN, json=bueno).status_code == 200
    for _ in range(settings.MAX_LOGIN_ATTEMPTS - 1):
        pg_client.post(LOGIN, json=malo)
    assert pg_client.post(LOGIN, json=bueno).status_code == 200


def test_token_de_recuperacion_vence_en_1_hora_y_es_de_un_solo_uso(pg_session, pg_admin, pg_client):
    casos = AuthUseCases(pg_session)
    token = casos.request_password_recovery(pg_admin.correo)
    rec = pg_session.query(TokenRecuperacion).filter_by(token_hash=compute_sha256_hash(token)).one()
    assert timedelta(minutes=59) < rec.expira_en - rec.created_at <= timedelta(minutes=60, seconds=5)

    r = pg_client.post("/api/v1/auth/reset-password", json={"token": token, "nueva_password": "NuevaClave2026!"})
    assert r.status_code == 200
    otra = pg_client.post("/api/v1/auth/reset-password", json={"token": token, "nueva_password": "OtraClave2026!"})
    assert otra.status_code == 422

    # Vencido (más de 1 h): se rechaza.
    token2 = casos.request_password_recovery(pg_admin.correo)
    rec2 = pg_session.query(TokenRecuperacion).filter_by(token_hash=compute_sha256_hash(token2)).one()
    rec2.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    rec2.expira_en = datetime.now(timezone.utc) - timedelta(minutes=1)
    pg_session.commit()
    vencido = pg_client.post("/api/v1/auth/reset-password", json={"token": token2, "nueva_password": "OtraClave2026!"})
    assert vencido.status_code == 422


def test_recuperacion_responde_igual_exista_o_no_el_correo(pg_client, pg_admin):
    a = pg_client.post("/api/v1/auth/recovery", json={"correo": pg_admin.correo})
    b = pg_client.post("/api/v1/auth/recovery", json={"correo": "nadie@gymos.co"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()


def test_subdominio_de_63_caracteres_se_acepta_y_64_no(pg_client, pg_headers):
    sub63 = ("gym-" + uuid.uuid4().hex * 2)[:62] + "x"
    assert len(sub63) == 63
    assert _alta(pg_client, pg_headers, sub63).status_code == 201
    r = _alta(pg_client, pg_headers, sub63[:-1] + "xy")
    assert r.status_code == 422 and r.json()["codigo"] == "SUBDOMINIO_INVALIDO"
    chk = pg_client.get("/api/v1/admin/gyms/check-subdomain", params={"subdomain": "ab"}, headers=pg_headers)
    assert chk.json()["valido"] is False


@pytest.mark.parametrize("palabra", ["admin", "www", "api", "app", "mail"])
def test_subdominio_reservado_se_rechaza(pg_client, pg_headers, palabra):
    r = _alta(pg_client, pg_headers, palabra)
    assert r.status_code == 422 and r.json()["codigo"] == "SUBDOMINIO_RESERVADO"
    chk = pg_client.get("/api/v1/admin/gyms/check-subdomain", params={"subdomain": palabra}, headers=pg_headers)
    assert chk.json()["valido"] is False


def test_la_bd_tambien_rechaza_reservados_y_mas_de_63(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    for malo in ("admin", "a" * 64):
        g = pg_session.get(Gimnasio, gid)
        g.subdominio = malo
        with pytest.raises(IntegrityError):
            pg_session.flush()
        pg_session.rollback()


def test_alta_simultanea_con_el_mismo_subdominio_responde_409(pg_client, pg_headers, monkeypatch):
    sub = f"carrera-{uuid.uuid4().hex[:6]}"
    crear_gimnasio(pg_client, pg_headers, subdominio=sub)
    # Simula que la segunda alta pasó la verificación previa antes de que la primera confirmara.
    monkeypatch.setattr(GymRepository, "get_by_subdomain", lambda self, s: None)
    r = _alta(pg_client, pg_headers, sub)
    assert r.status_code == 409 and r.json()["codigo"] == "SUBDOMINIO_EN_USO"


def test_registro_autonomo_con_nombre_reservado_recibe_subdominio_valido(pg_client):
    r =pg_client.get("/api/v1/public/subdomain-check", params={"nombre": "Admin"})
    assert r.json()["subdominio_sugerido"] == "admin-gym"
