"""Tarea 8 · Cancelación con exportación ZIP y eliminación definitiva (§2.4, SA-RF-30, SA-RF-31; contrato 3.4)."""
import csv
import io
import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.core import config as modulo_config
from app.core.fechas import hoy_bogota
from app.infrastructure.models.superadmin_models import (
    Auditoria, CuentaJefe, ExportacionGimnasio, Gimnasio, Pago
)
from pg_utilidades import contar_filas_tenant, crear_gimnasio, pagar, sembrar_datos_tenant


@pytest.fixture(autouse=True)
def _exports_en_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(modulo_config.settings, "EXPORTS_DIR", str(tmp_path / "exports"))


def _cancelar(client, headers, gym_id, motivo="Cierre definitivo del negocio"):
    return client.post(f"/api/v1/admin/gyms/{gym_id}/cancel", json={"motivo": motivo}, headers=headers)


def _ruta_publica(url):
    return url[url.index("/api/v1/public/exports/"):]


def _gym_con_datos(client, headers, session):
    gid = crear_gimnasio(client, headers, tipo="cliente_activo")
    assert pagar(client, headers, gid, 1, hoy_bogota()).status_code == 201
    tenant = session.get(Gimnasio, gid).gimnasio_id
    sembrar_datos_tenant(session, tenant)
    return gid, tenant


def _antiguedad_cancelacion(session, gid, dias):
    g = session.get(Gimnasio, gid)
    g.fecha_cancelacion = datetime.now(timezone.utc) - timedelta(days=dias)
    session.commit()


def test_el_rol_del_sa_no_lee_tablas_del_tenant(pg_session):
    with pytest.raises(ProgrammingError):
        pg_session.execute(text("SELECT count(*) FROM platform.deportistas")).scalar()
    pg_session.rollback()


def test_cancelar_genera_zip_con_csv_y_enlace_de_30_dias(pg_client, pg_headers, pg_session):
    gid, _ = _gym_con_datos(pg_client, pg_headers, pg_session)
    r = _cancelar(pg_client, pg_headers, gid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "cancelado" and body["export_url"]
    expira = datetime.fromisoformat(body["export_expira_en"])
    assert timedelta(days=29, hours=23) < expira - datetime.now(timezone.utc) <= timedelta(days=30)

    descarga = pg_client.get(_ruta_publica(body["export_url"]))
    assert descarga.status_code == 200
    assert descarga.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(descarga.content)) as z:
        assert set(z.namelist()) == {"deportistas.csv", "membresias.csv", "pagos.csv", "asistencia.csv"}
        filas = {n: list(csv.DictReader(io.StringIO(z.read(n).decode("utf-8-sig")))) for n in z.namelist()}
    assert filas["deportistas.csv"][0]["nombre"] == "Camila Ñúñez"
    assert len(filas["membresias.csv"]) == 1 and len(filas["asistencia.csv"]) == 1
    assert filas["pagos.csv"][0]["monto"] in ("90000", "90000.0", "90000.00")

    # SA-RF-30 CA3: cada descarga queda en auditoría.
    pg_client.get(_ruta_publica(body["export_url"]))
    assert pg_session.query(Auditoria).filter_by(accion="EXPORTACION_DESCARGADA", gimnasio_id=gid).count() == 2
    export = pg_session.query(ExportacionGimnasio).filter_by(gimnasio_id=gid).one()
    pg_session.refresh(export)
    assert export.descargas == 2
    token = body["export_url"].rsplit("/", 1)[1]
    assert export.token_hash != token  # se guarda el hash, no el token


def test_cancelar_por_cambio_de_estado_tambien_exporta(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    r = pg_client.patch(f"/api/v1/admin/gyms/{gid}/status", headers=pg_headers,
                        json={"nuevo_estado": "cancelado", "motivo": "Cliente desiste"})
    assert r.status_code == 200 and r.json()["export_url"]


def test_enlace_vencido_410_y_desconocido_404(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    url = _cancelar(pg_client, pg_headers, gid).json()["export_url"]
    export = pg_session.query(ExportacionGimnasio).filter_by(gimnasio_id=gid).one()
    export.created_at = datetime.now(timezone.utc) - timedelta(days=31)
    export.expira_en = datetime.now(timezone.utc) - timedelta(days=1)
    pg_session.commit()
    assert pg_client.get(_ruta_publica(url)).status_code == 410
    assert pg_client.get("/api/v1/public/exports/no-existe").status_code == 404


def test_eliminar_exige_30_dias_y_confirmacion(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    sub = pg_session.get(Gimnasio, gid).subdominio
    no_cancelado = pg_client.request("DELETE", f"/api/v1/admin/gyms/{gid}", headers=pg_headers,
                                     json={"confirmar_subdominio": sub})
    assert no_cancelado.status_code == 409 and no_cancelado.json()["codigo"] == "AUN_NO_ELIMINABLE"

    _cancelar(pg_client, pg_headers, gid)
    _antiguedad_cancelacion(pg_session, gid, 29)
    temprano = pg_client.request("DELETE", f"/api/v1/admin/gyms/{gid}", headers=pg_headers,
                                 json={"confirmar_subdominio": sub})
    assert temprano.status_code == 409 and temprano.json()["codigo"] == "AUN_NO_ELIMINABLE"

    _antiguedad_cancelacion(pg_session, gid, 30)
    mal = pg_client.request("DELETE", f"/api/v1/admin/gyms/{gid}", headers=pg_headers,
                            json={"confirmar_subdominio": "otro-subdominio"})
    assert mal.status_code == 422 and mal.json()["codigo"] == "CONFIRMACION_INVALIDA"
    assert pg_session.get(Gimnasio, gid).deleted_at is None


def test_eliminacion_definitiva_borra_tenant_invalida_enlace_y_libera_subdominio(pg_client, pg_headers, pg_session):
    gid, tenant = _gym_con_datos(pg_client, pg_headers, pg_session)
    gym = pg_session.get(Gimnasio, gid)
    sub = gym.subdominio
    correo_jefe = pg_session.query(CuentaJefe).filter_by(gimnasio_id=gid).one().correo
    url = _cancelar(pg_client, pg_headers, gid).json()["export_url"]
    ruta_zip = pg_session.query(ExportacionGimnasio).filter_by(gimnasio_id=gid).one().ruta_archivo
    assert os.path.isfile(ruta_zip)
    _antiguedad_cancelacion(pg_session, gid, 31)
    assert contar_filas_tenant(pg_session, tenant) > 5

    r = pg_client.request("DELETE", f"/api/v1/admin/gyms/{gid}", headers=pg_headers,
                          json={"confirmar_subdominio": sub.upper()})
    assert r.status_code == 200, r.text
    assert r.json()["subdominio_liberado"] == sub

    # CA3: datos del tenant borrados, enlace invalidado (410), ZIP borrado, subdominio libre.
    assert contar_filas_tenant(pg_session, tenant) == 0
    assert pg_client.get(_ruta_publica(url)).status_code == 410
    assert not os.path.exists(ruta_zip)
    assert pg_client.get(f"/api/v1/admin/gyms/{gid}", headers=pg_headers).status_code == 404
    nuevo = crear_gimnasio(pg_client, pg_headers, subdominio=sub,
                           jefe={"nombre": "Nuevo dueño", "correo": correo_jefe})
    assert nuevo != gid

    # MVC conserva sus pagos y la auditoría (CA4), sin datos del tenant.
    assert pg_session.query(Pago).filter_by(gimnasio_id=gid).count() == 1
    evento = pg_session.query(Auditoria).filter_by(accion="ELIMINACION_DEFINITIVA_GIMNASIO", gimnasio_id=gid).one()
    assert "Camila" not in str(evento.detalle)
