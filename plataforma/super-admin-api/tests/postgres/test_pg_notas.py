"""Pendiente #13 (parte) · SA-RF-28 Notas internas: texto, autor y fecha; no se editan."""
import uuid

from app.infrastructure.models.superadmin_models import Auditoria
from pg_utilidades import crear_gimnasio


def test_crear_y_listar_notas(pg_client, pg_headers, pg_admin, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers)
    url = f"/api/v1/admin/gyms/{gid}/notas"
    assert pg_client.get(url, headers=pg_headers).json() == []

    r1 = pg_client.post(url, headers=pg_headers, json={"texto": "  Pidió factura a nombre de la empresa  "})
    assert r1.status_code == 201, r1.text
    r2 = pg_client.post(url, headers=pg_headers, json={"texto": "Llamar el lunes por el cambio de plan"})
    assert r2.status_code == 201

    notas = pg_client.get(url, headers=pg_headers).json()
    assert [n["texto"] for n in notas] == ["Llamar el lunes por el cambio de plan", "Pidió factura a nombre de la empresa"]
    assert notas[0]["autor_nombre"] == pg_admin.nombre
    assert notas[0]["created_at"]
    assert pg_session.query(Auditoria).filter_by(accion="NOTA_INTERNA_CREADA", gimnasio_id=gid).count() == 2


def test_no_se_editan_y_validan(pg_client, pg_headers):
    gid = crear_gimnasio(pg_client, pg_headers)
    url = f"/api/v1/admin/gyms/{gid}/notas"
    assert pg_client.post(url, headers=pg_headers, json={"texto": "   "}).status_code == 422
    nota = pg_client.post(url, headers=pg_headers, json={"texto": "Original"}).json()
    # No hay ruta para editar ni borrar notas.
    assert pg_client.patch(f"{url}/{nota['id']}", headers=pg_headers, json={"texto": "x"}).status_code in (404, 405)
    assert pg_client.delete(f"{url}/{nota['id']}", headers=pg_headers).status_code in (404, 405)
    assert pg_client.get(f"/api/v1/admin/gyms/{uuid.uuid4()}/notas", headers=pg_headers).status_code == 404
