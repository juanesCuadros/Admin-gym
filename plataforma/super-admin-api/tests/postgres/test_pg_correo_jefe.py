"""Pendiente #12 · SA-RF-29 Editar el correo del Jefe."""
import uuid

from sqlalchemy import text

from app.infrastructure.models.superadmin_models import Auditoria, CuentaJefe, Gimnasio
from pg_utilidades import como_superusuario, crear_gimnasio


def _url(gid):
    return f"/api/v1/admin/gyms/{gid}/credentials/correo-jefe"


def _correo_staff_jefe(session, tenant_id):
    with como_superusuario(session):
        return session.execute(
            text("SELECT correo FROM platform.staff WHERE gimnasio_id = :g AND rol = 'jefe'"), {"g": tenant_id}
        ).scalar()


def test_cambia_el_correo_regenera_y_audita(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    tenant = pg_session.get(Gimnasio, gid).gimnasio_id
    anterior = pg_session.query(CuentaJefe).filter_by(gimnasio_id=gid).one().correo
    nuevo = f"nuevo-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"

    r = pg_client.patch(_url(gid), headers=pg_headers, json={"correo": nuevo})
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["correo_jefe"] == nuevo
    assert cuerpo["tipo"] == "regenerada"
    assert cuerpo["password_temporal"]  # CA2: credenciales nuevas en la misma operación

    pg_session.expire_all()
    assert pg_session.query(CuentaJefe).filter_by(gimnasio_id=gid).one().correo == nuevo
    assert _correo_staff_jefe(pg_session, tenant) == nuevo

    # CA3: auditoría con el correo anterior y el nuevo
    aud = pg_session.query(Auditoria).filter_by(accion="CAMBIO_CORREO_JEFE", gimnasio_id=gid).one()
    assert aud.detalle["correo_anterior"] == anterior
    assert aud.detalle["correo_nuevo"] == nuevo
    assert "password" not in str(aud.detalle).lower()


def test_rechaza_correo_de_otro_usuario_del_gimnasio(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    tenant = pg_session.get(Gimnasio, gid).gimnasio_id
    ocupado = f"recepcion-{uuid.uuid4().hex[:6]}@pruebas.gymos.co"
    with como_superusuario(pg_session):
        pg_session.execute(text("""
            INSERT INTO platform.staff (gimnasio_id, nombre, correo, hash_password, rol, activo)
            VALUES (:g, 'Recepción', :c, 'x', 'recepcionista', true)
        """), {"g": tenant, "c": ocupado})

    r = pg_client.patch(_url(gid), headers=pg_headers, json={"correo": ocupado.upper()})
    assert r.status_code == 409
    assert r.json()["codigo"] == "CORREO_YA_EXISTE"


def test_rechaza_correo_del_jefe_de_otro_gimnasio_y_el_mismo(pg_client, pg_headers, pg_session):
    gid_a = crear_gimnasio(pg_client, pg_headers)
    gid_b = crear_gimnasio(pg_client, pg_headers)
    correo_b = pg_session.query(CuentaJefe).filter_by(gimnasio_id=gid_b).one().correo
    correo_a = pg_session.query(CuentaJefe).filter_by(gimnasio_id=gid_a).one().correo

    r = pg_client.patch(_url(gid_a), headers=pg_headers, json={"correo": correo_b})
    assert r.status_code == 409

    r = pg_client.patch(_url(gid_a), headers=pg_headers, json={"correo": correo_a})
    assert r.status_code == 422
    assert r.json()["codigo"] == "CORREO_SIN_CAMBIO"

    assert pg_client.patch(_url(gid_a), headers=pg_headers, json={"correo": "no-es-correo"}).status_code == 422
