"""Escritorio · ingresos y cortesías que la estación registró y sube por `/sync/push`."""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.modules.control_ingreso.service import ControlIngresoService
from tests import sync_util as u
from tests.conftest import Fabrica
from tests.sync_util import API, acciones_auditoria, estacion_activa, sql

pytestmark = pytest.mark.asyncio

PUSH = f"{API}/sync/push"


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def op_ingreso(staff_id, deportista_id, resultado="abrio", estado="activo", ocurrida: Optional[datetime] = None, **extra) -> dict:
    op_id = str(uuid4())
    return {
        "id": op_id, "tipo": "ingreso", "idempotency_key": f"ing-{op_id}",
        "ocurrida_en": (ocurrida or ahora()).isoformat(),
        "staff_id": str(staff_id) if staff_id else None,
        "payload": {"deportista_id": str(deportista_id), "metodo": "manual", "resultado": resultado, "estado": estado, **extra},
    }


def op_cortesia(staff_id, motivo="Invitado del dueño", ocurrida: Optional[datetime] = None) -> dict:
    op_id = str(uuid4())
    return {
        "id": op_id, "tipo": "cortesia", "idempotency_key": f"cor-{op_id}",
        "ocurrida_en": (ocurrida or ahora()).isoformat(), "staff_id": str(staff_id), "payload": {"motivo": motivo},
    }


async def enviar(cliente: AsyncClient, headers: dict, *ops: dict, estacion_ahora: Optional[datetime] = None) -> list:
    cuerpo = {"operaciones": list(ops), "estacion_ahora": (estacion_ahora or ahora()).isoformat()}
    r = await cliente.post(PUSH, json=cuerpo, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["resultados"]


async def _checkins(gym_id) -> list:
    return await sql(gym_id, "SELECT * FROM platform.checkins ORDER BY id")


async def _revisiones(gym_id) -> list:
    return await sql(gym_id, "SELECT * FROM platform.sync_revisiones ORDER BY created_at")


async def _cliente_al_dia(gym_id, vence_en_dias=20) -> str:
    dep = await u.deportista(gym_id)
    await u.membresia(gym_id, dep, await u.plan(gym_id), vence_en_dias=vence_en_dias)
    return dep


async def test_el_ingreso_queda_con_la_hora_de_la_estacion_y_no_avisa_a_la_pantalla_tv(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, estacion, headers = await estacion_activa(cliente, fabrica)
    dep = await _cliente_al_dia(gym.id)
    avisos = []

    async def oyente(gym_id, checkin):
        avisos.append(checkin)

    ControlIngresoService.registrar_listener(oyente)
    try:
        hace_dos_horas = ahora() - timedelta(hours=2)
        op = op_ingreso(jefe["id"], dep, ocurrida=hace_dos_horas)
        resultado = (await enviar(cliente, headers, op))[0]
    finally:
        ControlIngresoService._listeners_checkin.remove(oyente)

    assert resultado["resultado"] == "aplicada", resultado
    fila = (await _checkins(gym.id))[0]
    assert resultado["datos"]["checkin_id"] == fila["id"]
    assert (fila["tipo"], fila["metodo"], fila["resultado"]) == ("ingreso", "manual", "abrio")
    assert str(fila["deportista_id"]) == dep and fila["registrado_por"] == jefe["id"]
    assert str(fila["estacion_id"]) == estacion["id"] and str(fila["operacion_id"]) == op["id"]
    # La hora es la del ingreso, no la de llegada.
    assert abs(fila["ts_utc"] - hace_dos_horas) < timedelta(seconds=1)
    assert fila["recibido_en"] - fila["ts_utc"] > timedelta(hours=1)
    assert await _revisiones(gym.id) == [] and avisos == []


async def test_reenviar_el_mismo_ingreso_no_lo_duplica(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    op = op_ingreso(jefe["id"], await _cliente_al_dia(gym.id))

    primera = (await enviar(cliente, headers, op))[0]
    repetida = (await enviar(cliente, headers, op))[0]
    assert (primera["resultado"], repetida["resultado"], repetida["resultado_original"]) == ("aplicada", "duplicada", "aplicada")
    assert repetida["datos"] == primera["datos"]
    assert len(await _checkins(gym.id)) == 1


async def test_un_cliente_de_otro_gimnasio_o_un_ingreso_sin_quien_lo_registro_es_invalido_y_no_guarda_nada(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()
    ajeno = await _cliente_al_dia(otro.id)
    propio = await _cliente_al_dia(gym.id)

    resultados = await enviar(
        cliente, headers,
        op_ingreso(jefe["id"], ajeno),
        op_ingreso(None, propio),
        {**op_ingreso(jefe["id"], propio), "payload": {"deportista_id": propio, "metodo": "telepatia", "resultado": "abrio", "estado": "activo"}},
    )
    assert [(r["resultado"], r["codigo"]) for r in resultados] == [
        ("invalida", "DEPORTISTA_DESCONOCIDO"), ("invalida", "STAFF_REQUERIDO"), ("invalida", "PAYLOAD_INVALIDO"),
    ]
    assert await _checkins(gym.id) == [] and await _checkins(otro.id) == []
    assert await sql(gym.id, "SELECT 1 FROM platform.sync_operaciones") == []


async def test_un_intento_negado_tambien_se_registra_y_no_queda_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    vencido = await _cliente_al_dia(gym.id, vence_en_dias=-10)

    resultado = (await enviar(cliente, headers, op_ingreso(jefe["id"], vencido, resultado="negado", estado="vencido")))[0]
    assert resultado["resultado"] == "aplicada"
    assert [c["resultado"] for c in await _checkins(gym.id)] == ["negado"]
    assert await _revisiones(gym.id) == []


async def test_si_la_estacion_dejo_entrar_y_el_servidor_habria_negado_se_registra_igual_y_queda_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id, "Carlos Pérez")
    mem = await u.membresia(gym.id, dep, await u.plan(gym.id), vence_en_dias=20)
    # Mientras la estación estaba sin red, en la web le cancelaron la membresía.
    await sql(gym.id, "UPDATE platform.membresias SET cancelada = true WHERE id = :id", {"id": mem})

    resultado = (await enviar(cliente, headers, op_ingreso(jefe["id"], dep, resultado="abrio", estado="activo")))[0]
    assert resultado["resultado"] == "pendiente_revision"
    assert resultado["revision"]["motivo_codigo"] == "ACCESO_NO_COINCIDE"
    assert "Carlos Pérez" in resultado["revision"]["motivo"]

    # El resultado no se cambia: la puerta ya se abrió.
    fila = (await _checkins(gym.id))[0]
    assert fila["resultado"] == "abrio"
    revision = (await _revisiones(gym.id))[0]
    assert (revision["entidad"], revision["entidad_id"], revision["estado_revision"]) == ("checkins", str(fila["id"]), "pendiente_revision")
    assert revision["detalle"]["estado_en_la_estacion"] == "activo" and revision["detalle"]["estado_en_el_servidor"] == "cancelado"
    assert "SYNC_PENDIENTE_REVISION" in [a["accion"] for a in await acciones_auditoria(gym.id)]


async def test_la_regla_se_evalua_con_el_dia_del_ingreso_no_con_el_dia_en_que_llego(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    # Venció hace 5 días: hoy está vencido, pero hace 4 días estaba en su primer día de gracia.
    dep = await _cliente_al_dia(gym.id, vence_en_dias=-5)
    op = op_ingreso(jefe["id"], dep, resultado="alerta_mora", estado="en_gracia", ocurrida=ahora() - timedelta(days=4))

    assert (await enviar(cliente, headers, op))[0]["resultado"] == "aplicada"
    assert await _revisiones(gym.id) == []


async def test_un_pase_de_dia_pagado_ese_dia_justifica_el_ingreso(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    con_pase = await u.deportista(gym.id)
    await u.venta(gym.id, jefe["id"], con_pase, "pase_dia")
    pase_anulado = await u.deportista(gym.id)
    await u.venta(gym.id, jefe["id"], pase_anulado, "pase_dia", anulada=True)

    resultados = await enviar(
        cliente, headers,
        op_ingreso(jefe["id"], con_pase, estado="sin_membresia", con_pase_dia=True),
        op_ingreso(jefe["id"], pase_anulado, estado="sin_membresia", con_pase_dia=True),
    )
    assert [r["resultado"] for r in resultados] == ["aplicada", "pendiente_revision"]


async def test_la_cortesia_exige_motivo_y_queda_en_auditoria(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    buena = op_cortesia(jefe["id"], "Invitado del dueño")

    resultados = await enviar(cliente, headers, buena, op_cortesia(jefe["id"], "ok"), op_cortesia(jefe["id"], "      "))
    assert [(r["resultado"], r["codigo"]) for r in resultados] == [
        ("aplicada", None), ("invalida", "PAYLOAD_INVALIDO"), ("invalida", "PAYLOAD_INVALIDO"),
    ]
    filas = await _checkins(gym.id)
    assert len(filas) == 1
    assert (filas[0]["tipo"], filas[0]["deportista_id"], filas[0]["motivo_cortesia"], filas[0]["resultado"]) == (
        "cortesia", None, "Invitado del dueño", "abrio",
    )
    registro = [a for a in await acciones_auditoria(gym.id) if a["accion"] == "INGRESO_CORTESIA"]
    assert len(registro) == 1 and registro[0]["detalle"]["motivo"] == "Invitado del dueño"
    assert registro[0]["detalle"]["operacion_id"] == buena["id"]


async def test_con_el_reloj_del_equipo_desfasado_la_hora_se_corrige_y_queda_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await _cliente_al_dia(gym.id)
    # El equipo va 2 horas atrasado. El ingreso fue hace 30 minutos reales.
    reloj_equipo = ahora() - timedelta(hours=2)
    op = op_ingreso(jefe["id"], dep, ocurrida=reloj_equipo - timedelta(minutes=30))

    resultado = (await enviar(cliente, headers, op, estacion_ahora=reloj_equipo))[0]
    assert resultado["resultado"] == "pendiente_revision" and resultado["revision"]["motivo_codigo"] == "RELOJ_DESFASADO"
    fila = (await _checkins(gym.id))[0]
    assert abs(fila["ts_utc"] - (ahora() - timedelta(minutes=30))) < timedelta(seconds=30)
    detalle = (await _revisiones(gym.id))[0]["detalle"]
    assert detalle["sentido"] == "atrasado" and 119 <= detalle["minutos"] <= 120


async def test_un_desfase_de_hasta_cinco_minutos_se_acepta_sin_corregir(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await _cliente_al_dia(gym.id)
    reloj_equipo = ahora() - timedelta(minutes=4)
    ocurrida = reloj_equipo - timedelta(minutes=10)

    resultado = (await enviar(cliente, headers, op_ingreso(jefe["id"], dep, ocurrida=ocurrida), estacion_ahora=reloj_equipo))[0]
    assert resultado["resultado"] == "aplicada"
    assert abs((await _checkins(gym.id))[0]["ts_utc"] - ocurrida) < timedelta(seconds=1)


async def test_una_hora_en_el_futuro_no_se_guarda_tal_cual(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await _cliente_al_dia(gym.id)
    # Equipo adelantado un día, y una versión vieja que no manda su reloj.
    op = op_ingreso(jefe["id"], dep, ocurrida=ahora() + timedelta(days=1))
    r = await cliente.post(PUSH, json={"operaciones": [op]}, headers=headers)
    assert r.json()["resultados"][0]["resultado"] == "pendiente_revision"
    assert (await _checkins(gym.id))[0]["ts_utc"] <= ahora()


async def test_quien_no_tiene_permiso_o_esta_desactivado_deja_el_ingreso_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await _cliente_al_dia(gym.id)
    sin_permiso = await fabrica.crear_staff(gym, rol="entrenador")
    con_permiso = await fabrica.crear_staff(gym, rol="recepcionista")
    desactivada = await fabrica.crear_staff(gym, rol="recepcionista", activo=False)
    await sql(gym.id, "DELETE FROM platform.permisos_rol WHERE gimnasio_id = :g", {"g": gym.id})
    await sql(
        gym.id,
        "INSERT INTO platform.permisos_rol (gimnasio_id, rol, submodulo, puede_crear, puede_leer) VALUES (:g, 'recepcionista', 'control_ingreso', true, true)",
        {"g": gym.id},
    )

    resultados = await enviar(
        cliente, headers,
        op_ingreso(con_permiso["id"], dep), op_ingreso(sin_permiso["id"], dep), op_ingreso(desactivada["id"], dep),
    )
    assert [(r["resultado"], (r["revision"] or {}).get("motivo_codigo")) for r in resultados] == [
        ("aplicada", None), ("pendiente_revision", "STAFF_SIN_PERMISO"), ("pendiente_revision", "STAFF_DESACTIVADO"),
    ]
    # Los tres quedaron registrados: ya pasaron.
    assert len(await _checkins(gym.id)) == 3


async def test_varios_motivos_dejan_una_sola_revision_con_los_demas_en_el_detalle(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    vencido = await _cliente_al_dia(gym.id, vence_en_dias=-30)
    reloj_equipo = ahora() - timedelta(hours=3)

    resultado = (await enviar(cliente, headers, op_ingreso(jefe["id"], vencido, ocurrida=reloj_equipo), estacion_ahora=reloj_equipo))[0]
    assert resultado["revision"]["motivo_codigo"] == "ACCESO_NO_COINCIDE"
    revisiones = await _revisiones(gym.id)
    assert len(revisiones) == 1
    assert [m["motivo_codigo"] for m in revisiones[0]["detalle"]["otros_motivos"]] == ["RELOJ_DESFASADO"]


async def test_los_ingresos_de_una_estacion_no_se_ven_desde_otro_gimnasio(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()
    await enviar(cliente, headers, op_ingreso(jefe["id"], await _cliente_al_dia(gym.id)), op_cortesia(jefe["id"]))
    assert len(await _checkins(gym.id)) == 2 and await _checkins(otro.id) == []
