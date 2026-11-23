"""Escritorio · fase 3B (parte 1): renovar y vender membresías que la estación cobró sin red (`/sync/push`)."""
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica
from tests.sync_util import API, descargar_todo, estacion_activa, sql
from tests import sync_util as u
from tests.test_e9_sync_caja import _resumen, _revisiones, abrir, cerrar, enviar, op

pytestmark = pytest.mark.asyncio


def hoy() -> date:
    return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def cobro(tipo: str, staff_id, turno: dict, membresia_id: str, deportista_id: str, precio=80000, cobrado=None,
          tipo_medio="efectivo", metodo="Efectivo", pagos=None, **extra) -> dict:
    payload = {"turno_id": turno["id"], "membresia_id": membresia_id, "deportista_id": deportista_id, "dias": 30,
               "precio_lista": precio, "precio_cobrado": precio if cobrado is None else cobrado,
               "tipo_medio": tipo_medio, "metodo": metodo, **extra}
    if pagos:
        payload["pagos"] = pagos
    return op(tipo, staff_id, payload, depende_de=[turno["id"]])


def renovar(staff_id, turno, membresia_id, deportista_id, anterior: date, nueva: date, **kw) -> dict:
    return cobro("membresia_renovar", staff_id, turno, membresia_id, deportista_id,
                 fecha_vencimiento_anterior=anterior.isoformat(), fecha_vencimiento_nueva=nueva.isoformat(), **kw)


def vender(staff_id, turno, deportista_id, plan_id, membresia_id: Optional[str] = None, **kw) -> dict:
    return cobro("membresia_vender", staff_id, turno, membresia_id or str(uuid4()), deportista_id, plan_id=plan_id,
                 fecha_inicio=hoy().isoformat(), fecha_vencimiento=(hoy() + timedelta(days=30)).isoformat(), **kw)


async def _membresia(gym_id, mem_id) -> dict:
    return (await sql(gym_id, "SELECT * FROM platform.membresias WHERE id = :m", {"m": mem_id}))[0]


async def _pago(gym_id, pago_id) -> dict:
    return (await sql(gym_id, "SELECT * FROM platform.pagos_membresia WHERE id = :p", {"p": pago_id}))[0]


async def test_renovar_y_cerrar_el_turno_cuadra_en_el_servidor(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id)
    plan = await u.plan(gym.id)
    mem = await u.membresia(gym.id, dep, plan, vence_en_dias=10)
    venc = hoy() + timedelta(days=10)
    t = abrir(jefe["id"], base=20000)
    r = renovar(jefe["id"], t, str(mem), dep, venc, venc + timedelta(days=30), valor_recibido=100000)
    # Efectivo esperado: 20.000 + 80.000
    res = await enviar(cliente, he, t, r, cerrar(jefe["id"], t, contado=100000, esperado=100000))
    assert [x["resultado"] for x in res] == ["aplicada"] * 3, res
    assert res[1]["datos"]["fecha_vencimiento"] == (venc + timedelta(days=30)).isoformat()

    assert (await _membresia(gym.id, mem))["fecha_vencimiento"] == venc + timedelta(days=30)
    pago = await _pago(gym.id, r["id"])
    assert (str(pago["turno_id"]), float(pago["monto"]), pago["es_venta"], pago["dias_agregados"]) == (t["id"], 80000, False, 30)
    assert pago["recibido_en"] is not None and pago["idempotency_key"] == r["idempotency_key"]

    turno = await _resumen(cliente, hj, t["id"])
    assert float(turno["pagos_membresia_efectivo"]) == 80000
    assert float(turno["total_esperado_efectivo"]) == 100000
    assert float(turno["diferencia"]) == 0
    assert "RENOVAR_MEMBRESIA_ESTACION" in [a["accion"] for a in await u.acciones_auditoria(gym.id)]

    # El reenvío no repite nada.
    res2 = await enviar(cliente, he, r)
    assert res2[0]["resultado"] == "duplicada"
    assert len(await sql(gym.id, "SELECT id FROM platform.pagos_membresia WHERE membresia_id = :m", {"m": mem})) == 1


async def test_si_la_fecha_no_coincide_manda_la_del_servidor_y_queda_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id)
    plan = await u.plan(gym.id)
    # Venció hace 2 días y entró en la gracia (registrado en la web): el servidor cuenta desde el vencimiento.
    mem = await u.membresia(gym.id, dep, plan, vence_en_dias=-2)
    venc = hoy() - timedelta(days=2)
    await sql(gym.id, """INSERT INTO platform.checkins (gimnasio_id, deportista_id, tipo, metodo, resultado, ts_utc)
                         VALUES (:g, :d, 'ingreso', 'manual', 'alerta_mora', now() - interval '1 day')""", {"g": gym.id, "d": dep})
    t = abrir(jefe["id"])
    # La estación no conocía ese ingreso: calculó desde hoy.
    r = renovar(jefe["id"], t, str(mem), dep, venc, hoy() + timedelta(days=30))
    res = await enviar(cliente, he, t, r)
    assert res[1]["resultado"] == "pendiente_revision", res
    assert res[1]["revision"]["motivo_codigo"] == "FECHA_RENOVACION_DISTINTA"
    assert (await _membresia(gym.id, mem))["fecha_vencimiento"] == venc + timedelta(days=30)


async def test_vender_crea_la_membresia_con_el_id_de_la_estacion_y_pago_mixto(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id)
    plan = await u.plan(gym.id)
    mem = str(uuid4())
    t = abrir(jefe["id"], base=0)
    v = vender(jefe["id"], t, dep, plan, membresia_id=mem, tipo_medio="mixto", metodo="mixto",
               pagos=[{"metodo": "Efectivo", "tipo_medio": "efectivo", "monto": 30000}, {"metodo": "Nequi", "tipo_medio": "otro", "monto": 50000}])
    res = await enviar(cliente, he, t, v)
    assert [x["resultado"] for x in res] == ["aplicada"] * 2, res

    m = await _membresia(gym.id, mem)
    assert (str(m["deportista_id"]), m["fecha_inicio"], m["fecha_vencimiento"], float(m["plan_precio_vendido"])) == (
        dep, hoy(), hoy() + timedelta(days=30), 80000)
    pago = await _pago(gym.id, v["id"])
    assert (pago["es_venta"], pago["tipo_medio"]) == (True, "mixto")
    medios = await sql(gym.id, "SELECT tipo_medio, monto FROM platform.cobro_medios WHERE pago_membresia_id = :p ORDER BY monto", {"p": v["id"]})
    assert [(x["tipo_medio"], float(x["monto"])) for x in medios] == [("efectivo", 30000), ("otro", 50000)]
    turno = await _resumen(cliente, hj, t["id"])
    assert (float(turno["pagos_membresia_efectivo"]), float(turno["pagos_membresia_otro"])) == (30000, 50000)
    assert float(turno["total_esperado_efectivo"]) == 30000

    # La descarga trae la membresía con su precio vendido.
    cambios, _, _ = await descargar_todo(cliente, he)
    fila = next(x for x in cambios["membresias"] if x["id"] == mem)
    assert fila["plan_precio_vendido"] == 80000


async def test_conflictos_se_registran_igual_y_quedan_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    plan = await u.plan(gym.id)
    t = abrir(jefe["id"], base=0)

    # 1. Le vendió un plan a quien ya tenía membresía (se la vendieron en la web mientras no había red).
    con_membresia = await u.deportista(gym.id, nombre="Luis")
    await u.membresia(gym.id, con_membresia, plan, vence_en_dias=20)
    v = vender(jefe["id"], t, con_membresia, plan)
    # 2. Renovó una membresía que el Jefe canceló mientras tanto.
    otro = await u.deportista(gym.id, nombre="Marta")
    cancelada = await u.membresia(gym.id, otro, plan, vence_en_dias=5, cancelada=True)
    venc = hoy() + timedelta(days=5)
    r = renovar(jefe["id"], t, str(cancelada), otro, venc, venc + timedelta(days=30))
    # 3. Cobró con un precio distinto al vigente y un descuento que la regla no permite.
    tercero = await u.deportista(gym.id, nombre="Carlos")
    d = vender(jefe["id"], t, tercero, plan, precio=75000, cobrado=60000, motivo_descuento="Promoción")

    res = await enviar(cliente, he, t, v, r, d)
    assert [x["resultado"] for x in res] == ["aplicada", "pendiente_revision", "pendiente_revision", "pendiente_revision"], res
    assert res[1]["revision"]["motivo_codigo"] == "MEMBRESIA_YA_EXISTIA"
    assert res[2]["revision"]["motivo_codigo"] == "MEMBRESIA_CANCELADA"
    assert res[3]["revision"]["motivo_codigo"] == "PRECIO_DISTINTO"

    assert len(await sql(gym.id, "SELECT id FROM platform.membresias WHERE deportista_id = :d AND NOT cancelada", {"d": con_membresia})) == 2
    assert (await _membresia(gym.id, cancelada))["fecha_vencimiento"] == venc
    assert (await _pago(gym.id, r["id"]))["dias_agregados"] == 0
    assert float((await _pago(gym.id, d["id"]))["monto"]) == 60000
    # Ningún peso se perdió: los tres cobros están en el turno.
    turno = await _resumen(cliente, hj, t["id"])
    assert float(turno["pagos_membresia_efectivo"]) == 80000 + 80000 + 60000
    assert {x["motivo_codigo"] for x in await _revisiones(gym.id)} >= {"MEMBRESIA_YA_EXISTIA", "MEMBRESIA_CANCELADA", "PRECIO_DISTINTO"}


async def test_lo_que_no_se_puede_guardar_es_invalido_y_no_deja_nada(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id)
    t = abrir(jefe["id"], base=0)
    r = renovar(jefe["id"], t, str(uuid4()), dep, hoy(), hoy() + timedelta(days=30))
    mal = cobro("membresia_renovar", jefe["id"], t, str(uuid4()), dep)  # sin fechas
    descuento_sin_motivo = vender(jefe["id"], t, dep, await u.plan(gym.id), cobrado=70000)
    res = await enviar(cliente, he, t, r, mal, descuento_sin_motivo)
    assert [(x["resultado"], x.get("codigo")) for x in res[1:]] == [
        ("invalida", "MEMBRESIA_DESCONOCIDA"), ("invalida", "PAYLOAD_INVALIDO"), ("invalida", "MOTIVO_DESCUENTO_REQUERIDO")], res
    assert await sql(gym.id, "SELECT id FROM platform.pagos_membresia") == []
