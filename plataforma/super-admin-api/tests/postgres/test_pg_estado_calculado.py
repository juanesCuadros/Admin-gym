"""Tarea 3 · Estado calculado en el panel (contrato 3.3; SA-RF-01, 02, 32) desde platform.estado_suscripcion()."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.core.fechas import hoy_bogota
from app.infrastructure.models.superadmin_models import Gimnasio, PlanSuscripcion, SolicitudPlan
from pg_utilidades import crear_gimnasio


def _gym_con_corte(client, headers, session, dias_desde_hoy, tipo="cliente_activo", estado=None):
    gym_id = crear_gimnasio(client, headers, tipo=tipo)
    gym = session.get(Gimnasio, gym_id)
    gym.fecha_corte = hoy_bogota() + timedelta(days=dias_desde_hoy)
    gym.estado = estado or ("prueba" if tipo == "prueba" else "activo")
    session.commit()
    return gym_id


def _metricas(client, headers):
    r = client.get("/api/v1/admin/dashboard/metrics", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(client, headers, **params):
    r = client.get("/api/v1/admin/gyms", params={"limit": 200, **params}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_el_rol_del_superadmin_puede_ejecutar_la_funcion(pg_session):
    assert pg_session.execute(text("SELECT current_user")).scalar() == "gymos_superadmin"
    assert pg_session.execute(text(
        "SELECT has_function_privilege('gymos_superadmin', 'platform.estado_suscripcion(uuid)', 'EXECUTE')"
    )).scalar() is True


def test_listado_trae_estado_calculado_de_la_bd_y_filtra(pg_client, pg_headers, pg_session):
    antes = _metricas(pg_client, pg_headers)
    al_dia = _gym_con_corte(pg_client, pg_headers, pg_session, 30)
    por_vencer = _gym_con_corte(pg_client, pg_headers, pg_session, 3)
    en_gracia = _gym_con_corte(pg_client, pg_headers, pg_session, -2)
    bloqueado = _gym_con_corte(pg_client, pg_headers, pg_session, -10)
    prueba_pv = _gym_con_corte(pg_client, pg_headers, pg_session, 1, tipo="prueba")
    prueba_vencida = _gym_con_corte(pg_client, pg_headers, pg_session, -1, tipo="prueba")
    suspendido = _gym_con_corte(pg_client, pg_headers, pg_session, 30, estado="suspendido")

    filas = {f["id"]: f for f in _ids(pg_client, pg_headers)}
    esperado = {
        al_dia: "al_dia", por_vencer: "por_vencer", en_gracia: "en_gracia", bloqueado: "bloqueado",
        prueba_pv: "por_vencer", prueba_vencida: "bloqueado", suspendido: "bloqueado",
    }
    for gid, estado in esperado.items():
        assert filas[gid]["estado_calculado"] == estado, (gid, filas[gid])
        # Mismo valor que la función de la BD (no se recalcula en Python).
        fn = pg_session.execute(
            text("SELECT estado_calculado, dias_restantes FROM platform.estado_suscripcion(CAST(:g AS uuid))"),
            {"g": filas[gid]["gimnasio_id"]},
        ).one()
        assert (filas[gid]["estado_calculado"], filas[gid]["dias_restantes"]) == (fn[0], fn[1])
    assert filas[bloqueado]["dias_restantes"] == -10
    assert filas[prueba_vencida]["motivo_bloqueo"] == "prueba_vencida"
    assert filas[suspendido]["motivo_bloqueo"] == "suspendido"

    en_gracia_ids = {f["id"] for f in _ids(pg_client, pg_headers, estado_calculado="en_gracia")}
    assert en_gracia in en_gracia_ids and bloqueado not in en_gracia_ids
    bloq_ids = {f["id"] for f in _ids(pg_client, pg_headers, estado_calculado="bloqueado")}
    assert {bloqueado, prueba_vencida, suspendido} <= bloq_ids and al_dia not in bloq_ids
    ppv = {f["id"] for f in _ids(pg_client, pg_headers, estado_calculado="prueba_por_vencer")}
    assert prueba_pv in ppv and por_vencer not in ppv

    malo = pg_client.get("/api/v1/admin/gyms", params={"estado_calculado": "moroso"}, headers=pg_headers)
    assert malo.status_code == 422

    despues = _metricas(pg_client, pg_headers)
    assert despues["en_gracia"] - antes["en_gracia"] == 1
    assert despues["bloqueados"] - antes["bloqueados"] == 3
    assert despues["por_vencer"] - antes["por_vencer"] == 2  # por_vencer + prueba por vencer
    assert despues["pruebas_por_vencer"] - antes["pruebas_por_vencer"] == 1
    assert despues["pruebas_nuevas_7d"] - antes["pruebas_nuevas_7d"] == 2


def test_orden_de_urgencia_sa_rf_02(pg_client, pg_headers, pg_session):
    al_dia = _gym_con_corte(pg_client, pg_headers, pg_session, 40)
    por_vencer = _gym_con_corte(pg_client, pg_headers, pg_session, 4)
    prueba_pv = _gym_con_corte(pg_client, pg_headers, pg_session, 2, tipo="prueba")
    en_gracia = _gym_con_corte(pg_client, pg_headers, pg_session, -3)
    bloqueado = _gym_con_corte(pg_client, pg_headers, pg_session, -20)
    cancelado = _gym_con_corte(pg_client, pg_headers, pg_session, -20)
    g = pg_session.get(Gimnasio, cancelado)
    g.estado, g.motivo_cancelacion, g.fecha_cancelacion = "cancelado", "Cierre", datetime.now(timezone.utc)
    pg_session.commit()

    orden = [f["id"] for f in _ids(pg_client, pg_headers, order_by="urgency")]
    nuestros = [i for i in orden if i in {al_dia, por_vencer, prueba_pv, en_gracia, bloqueado, cancelado}]
    assert nuestros == [bloqueado, en_gracia, prueba_pv, por_vencer, al_dia, cancelado]


def test_ficha_trae_estado_calculado(pg_client, pg_headers, pg_session):
    gid = _gym_con_corte(pg_client, pg_headers, pg_session, -2)
    r = pg_client.get(f"/api/v1/admin/gyms/{gid}", headers=pg_headers)
    assert r.status_code == 200
    assert r.json()["estado_calculado"] == "en_gracia"
    assert r.json()["dias_restantes"] == -2


def test_metricas_listos_para_eliminar_y_solicitudes(pg_client, pg_headers, pg_session):
    antes = _metricas(pg_client, pg_headers)
    viejo = crear_gimnasio(pg_client, pg_headers)
    reciente = crear_gimnasio(pg_client, pg_headers)
    for gid, dias in ((viejo, 31), (reciente, 5)):
        g = pg_session.get(Gimnasio, gid)
        g.estado, g.motivo_cancelacion = "cancelado", "Cierre del negocio"
        g.fecha_cancelacion = datetime.now(timezone.utc) - timedelta(days=dias)
    plan = pg_session.query(PlanSuscripcion).filter_by(codigo="mensual").one()
    pg_session.add(SolicitudPlan(gimnasio_id=reciente, plan_id=plan.id, solicitado_por="Jefe"))
    pg_session.commit()

    despues = _metricas(pg_client, pg_headers)
    assert despues["listos_para_eliminar"] - antes["listos_para_eliminar"] == 1
    assert despues["solicitudes_plan_pendientes"] - antes["solicitudes_plan_pendientes"] == 1
    # Los cancelados no cuentan como bloqueados en el panel.
    assert despues["bloqueados"] == antes["bloqueados"]
