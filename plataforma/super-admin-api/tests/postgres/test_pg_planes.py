"""Tarea 5 · Planes de suscripción (SA-RF-33, contrato 3.1): CRUD, plan_id en el alta y cambio manual."""
import uuid
from datetime import timedelta

from app.core.fechas import hoy_bogota
from app.infrastructure.models.superadmin_models import Auditoria, Suscripcion
from pg_utilidades import crear_gimnasio, plan_id

BASE = "/api/v1/admin/plans"


def _nuevo_plan(client, headers, **extra):
    body = {
        "codigo": f"pro_{uuid.uuid4().hex[:6]}", "nombre": "Plan Pro", "tipo": "pago",
        "precio": 180000, "duracion_meses": 1, "max_clientes_activos": 500, "max_staff": 10,
    }
    body.update(extra)
    return client.post(BASE, json=body, headers=headers)


def test_listar_planes_incluye_los_sembrados_y_sus_campos(pg_client, pg_headers):
    r = pg_client.get(BASE, headers=pg_headers)
    assert r.status_code == 200
    codigos = {p["codigo"]: p for p in r.json()}
    assert {"prueba", "mensual", "anual"} <= set(codigos)
    esperados = {"id", "codigo", "nombre", "descripcion", "tipo", "precio", "duracion_meses", "dias_prueba",
                 "max_clientes_activos", "max_staff", "activo", "publico", "orden", "gimnasios_actuales"}
    assert esperados <= set(codigos["prueba"])


def test_crear_plan_201_y_codigo_duplicado_409(pg_client, pg_headers, pg_session):
    r = _nuevo_plan(pg_client, pg_headers)
    assert r.status_code == 201, r.text
    assert r.json()["version"] == 1 and r.json()["gimnasios_actuales"] == 0
    dup = _nuevo_plan(pg_client, pg_headers, codigo=r.json()["codigo"])
    assert dup.status_code == 409
    assert dup.json()["codigo"] == "CODIGO_DUPLICADO"
    assert pg_session.query(Auditoria).filter_by(accion="CREACION_PLAN", entidad_id=r.json()["id"]).count() == 1


def test_crear_plan_incoherente_422(pg_client, pg_headers):
    r = _nuevo_plan(pg_client, pg_headers, duracion_meses=None)
    assert r.status_code == 422 and r.json()["codigo"] == "PLAN_INCOHERENTE"
    r = _nuevo_plan(pg_client, pg_headers, tipo="prueba", precio=1000, duracion_meses=None, dias_prueba=5)
    assert r.status_code == 422 and r.json()["codigo"] == "PLAN_INCOHERENTE"


def test_editar_plan_con_version_y_campos_no_editables(pg_client, pg_headers):
    plan = _nuevo_plan(pg_client, pg_headers).json()
    body = {k: plan[k] for k in ("nombre", "descripcion", "precio", "duracion_meses", "dias_prueba",
                                 "max_clientes_activos", "max_staff", "publico", "orden")}
    body.update(nombre="Plan Pro 2026", precio=200000, version=plan["version"])
    r = pg_client.put(f"{BASE}/{plan['id']}", json=body, headers=pg_headers)
    assert r.status_code == 200, r.text
    assert r.json()["precio"] == 200000 and r.json()["version"] == plan["version"] + 1

    viejo = pg_client.put(f"{BASE}/{plan['id']}", json=body, headers=pg_headers)  # versión vieja
    assert viejo.status_code == 409 and viejo.json()["codigo"] == "VERSION_DESACTUALIZADA"

    body.update(version=r.json()["version"], codigo="otro")
    assert pg_client.put(f"{BASE}/{plan['id']}", json=body, headers=pg_headers).json()["codigo"] == "CAMPO_NO_EDITABLE"
    body.pop("codigo")
    body["tipo"] = "prueba"
    r2 = pg_client.put(f"{BASE}/{plan['id']}", json=body, headers=pg_headers)
    assert r2.status_code == 422 and r2.json()["codigo"] == "CAMPO_NO_EDITABLE"


def test_activar_y_desactivar_plan(pg_client, pg_headers):
    plan = _nuevo_plan(pg_client, pg_headers).json()
    r = pg_client.patch(f"{BASE}/{plan['id']}/status", json={"activo": False}, headers=pg_headers)
    assert r.status_code == 200 and r.json()["activo"] is False


def test_escrituras_de_plan_devuelven_gimnasios_actuales(pg_client, pg_headers):
    """Editar o cambiar el estado de un plan responde el mismo conteo de gimnasios que el listado."""
    crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    listado = {p["codigo"]: p for p in pg_client.get(BASE, headers=pg_headers).json()}
    mensual = listado["mensual"]
    assert mensual["gimnasios_actuales"] >= 1

    body = {k: mensual[k] for k in ("nombre", "descripcion", "precio", "duracion_meses", "dias_prueba",
                                    "max_clientes_activos", "max_staff", "publico", "orden", "version")}
    r = pg_client.put(f"{BASE}/{mensual['id']}", json=body, headers=pg_headers)
    assert r.status_code == 200, r.text
    assert r.json()["gimnasios_actuales"] == mensual["gimnasios_actuales"]

    r2 = pg_client.patch(f"{BASE}/{mensual['id']}/status", json={"activo": True}, headers=pg_headers)
    assert r2.status_code == 200 and r2.json()["gimnasios_actuales"] == mensual["gimnasios_actuales"]


def test_alta_exige_plan_id_activo_y_coherente(pg_client, pg_headers, pg_session):
    sufijo = uuid.uuid4().hex[:6]
    base = {
        "nombre": f"Gym Plan {sufijo}", "subdominio": f"gym-plan-{sufijo}",
        "jefe": {"nombre": "Jefe", "correo": f"j-{sufijo}@pruebas.gymos.co"},
    }
    sin_plan = pg_client.post("/api/v1/admin/gyms", headers=pg_headers,
                              json={**base, "suscripcion": {"valor_mensual": 0, "tipo_inicio": "prueba"}})
    assert sin_plan.status_code == 422

    anual = next(p for p in pg_client.get(BASE, headers=pg_headers).json() if p["codigo"] == "anual")
    assert anual["activo"] is False
    inactivo = pg_client.post("/api/v1/admin/gyms", headers=pg_headers, json={
        **base, "suscripcion": {"valor_mensual": 0, "tipo_inicio": "cliente_activo", "plan_id": anual["id"]}})
    assert inactivo.status_code == 422 and inactivo.json()["codigo"] == "PLAN_NO_DISPONIBLE"

    mensual = plan_id(pg_client, pg_headers, "mensual")
    incoherente = pg_client.post("/api/v1/admin/gyms", headers=pg_headers, json={
        **base, "suscripcion": {"valor_mensual": 0, "tipo_inicio": "prueba", "plan_id": mensual}})
    assert incoherente.status_code == 422 and incoherente.json()["codigo"] == "PLAN_INCOHERENTE"

    prueba = plan_id(pg_client, pg_headers, "prueba")
    ok = pg_client.post("/api/v1/admin/gyms", headers=pg_headers, json={
        **base, "suscripcion": {"valor_mensual": 0, "tipo_inicio": "prueba", "plan_id": prueba}})
    assert ok.status_code == 201, ok.text
    gid = ok.json()["gimnasio"]["id"]
    assert pg_session.query(Suscripcion).filter_by(gimnasio_id=gid).one().plan_id == prueba
    ficha = pg_client.get(f"/api/v1/admin/gyms/{gid}", headers=pg_headers).json()
    assert ficha["plan_nombre"] == "Prueba gratis"
    assert ficha["fecha_corte"] == (hoy_bogota() + timedelta(days=5)).isoformat()


def test_cambio_de_plan_manual(pg_client, pg_headers, pg_session):
    gid = crear_gimnasio(pg_client, pg_headers, tipo="cliente_activo")
    pro = _nuevo_plan(pg_client, pg_headers).json()
    hoy = hoy_bogota()

    antes_vigencia = pg_client.patch(f"/api/v1/admin/gyms/{gid}/plan", headers=pg_headers,
                                     json={"plan_id": pro["id"], "vigente_desde": (hoy - timedelta(days=1)).isoformat()})
    assert antes_vigencia.status_code == 422 and antes_vigencia.json()["codigo"] == "VIGENCIA_INVALIDA"

    r = pg_client.patch(f"/api/v1/admin/gyms/{gid}/plan", headers=pg_headers,
                        json={"plan_id": pro["id"], "vigente_desde": hoy.isoformat()})
    assert r.status_code == 200, r.text
    assert r.json()["plan_nombre"] == "Plan Pro" and r.json()["valor_mensual"] == 180000

    subs = pg_session.query(Suscripcion).filter_by(gimnasio_id=gid).order_by(Suscripcion.created_at).all()
    assert len(subs) == 2
    assert subs[0].vigente_hasta == hoy and subs[1].vigente_hasta is None and subs[1].plan_id == pro["id"]

    mismo = pg_client.patch(f"/api/v1/admin/gyms/{gid}/plan", headers=pg_headers, json={"plan_id": pro["id"]})
    assert mismo.status_code == 422 and mismo.json()["codigo"] == "PLAN_SIN_CAMBIO"

    planes = {p["id"]: p for p in pg_client.get(BASE, headers=pg_headers).json()}
    assert planes[pro["id"]]["gimnasios_actuales"] == 1
    fila = next(f for f in pg_client.get("/api/v1/admin/gyms", params={"limit": 200}, headers=pg_headers).json()
                if f["id"] == gid)
    assert fila["plan_nombre"] == "Plan Pro"
    assert pg_session.query(Auditoria).filter_by(accion="CAMBIO_PLAN_GIMNASIO", gimnasio_id=gid).count() == 1
