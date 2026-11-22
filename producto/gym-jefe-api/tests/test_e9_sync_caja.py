"""Escritorio · fase 3A: turno, venta de mostrador y egresos que la estación registró sin red (`/sync/push`)."""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica
from tests.sync_util import API, estacion_activa, sql
from tests import sync_util as u

pytestmark = pytest.mark.asyncio

PUSH = f"{API}/sync/push"


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def op(tipo: str, staff_id, payload: dict, depende_de: Optional[list] = None, ocurrida: Optional[datetime] = None) -> dict:
    op_id = str(uuid4())
    return {
        "id": op_id, "tipo": tipo, "idempotency_key": f"gd-{op_id}", "ocurrida_en": (ocurrida or ahora()).isoformat(),
        "staff_id": str(staff_id), "depende_de": depende_de or [], "payload": payload,
    }


def abrir(staff_id, base=50000, **extra) -> dict:
    return op("turno_abrir", staff_id, {"base_inicial": base, **extra})


def venta(staff_id, turno: dict, items: list, tipo_medio="efectivo", metodo="Efectivo", pagos=None, deportista_id=None, **extra) -> dict:
    total = sum(i["precio_cobrado"] * i["cantidad"] for i in items)
    payload = {"turno_id": turno["id"], "items": items, "total": total, "tipo_medio": tipo_medio, "metodo": metodo, **extra}
    if pagos:
        payload["pagos"] = pagos
    if deportista_id:
        payload["deportista_id"] = deportista_id
    return op("venta", staff_id, payload, depende_de=[turno["id"]])


def item_producto(producto_id, precio=3000, cantidad=1, cobrado=None, motivo=None) -> dict:
    return {"tipo": "producto", "producto_id": str(producto_id), "descripcion": "Agua", "cantidad": cantidad,
            "precio_lista": precio, "precio_cobrado": precio if cobrado is None else cobrado, "motivo_descuento": motivo}


def item_pase(tipo="pase_dia", precio=15000) -> dict:
    return {"tipo": tipo, "descripcion": "Pase de día" if tipo == "pase_dia" else "Pase de clase", "cantidad": 1,
            "precio_lista": precio, "precio_cobrado": precio}


def egreso(staff_id, turno: dict, monto=8000, motivo="Compra de hielo") -> dict:
    return op("egreso", staff_id, {"turno_id": turno["id"], "monto": monto, "motivo": motivo}, depende_de=[turno["id"]])


def cerrar(staff_id, turno: dict, contado: int, esperado: int) -> dict:
    return op("turno_cerrar", staff_id, {"turno_id": turno["id"], "efectivo_contado": contado, "total_esperado_efectivo": esperado},
              depende_de=[turno["id"]])


async def enviar(cliente: AsyncClient, headers: dict, *ops: dict) -> list:
    r = await cliente.post(PUSH, json={"operaciones": list(ops), "estacion_ahora": ahora().isoformat()}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["resultados"]


async def producto(gym_id, stock=10, precio=3000) -> str:
    pid = uuid4()
    await sql(gym_id, "INSERT INTO platform.productos (id, gimnasio_id, nombre, precio, stock) VALUES (:id, :g, :n, :p, :s)",
              {"id": pid, "g": gym_id, "n": f"Agua {pid.hex[:5]}", "p": precio, "s": stock})
    return str(pid)


async def _revisiones(gym_id) -> list:
    return await sql(gym_id, "SELECT entidad, entidad_id, motivo_codigo, motivo, detalle FROM platform.sync_revisiones ORDER BY created_at")


async def _resumen(cliente: AsyncClient, headers_jefe: dict, turno_id: str) -> dict:
    hoy = (ahora() - timedelta(hours=5)).date().isoformat()
    for estado in ("cerrado", "abierto"):
        r = await cliente.get(f"{API}/caja/turnos", params={"desde": hoy, "hasta": hoy, "estado": estado, "limite": 100}, headers=headers_jefe)
        assert r.status_code == 200, r.text
        for t in r.json()["items"]:
            if t["id"] == turno_id:
                return t
    raise AssertionError("turno no encontrado")


async def test_un_dia_de_caja_queda_igual_en_el_servidor(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    pid = await producto(gym.id, stock=10)
    dep = await u.deportista(gym.id)
    t = abrir(jefe["id"], base=50000)
    ops = [
        t,
        venta(jefe["id"], t, [item_producto(pid, cantidad=2)], valor_recibido=10000),
        venta(jefe["id"], t, [item_pase("pase_dia", 15000)], tipo_medio="mixto", metodo="mixto", deportista_id=dep,
              pagos=[{"metodo": "Efectivo", "tipo_medio": "efectivo", "monto": 5000}, {"metodo": "Nequi", "tipo_medio": "otro", "monto": 10000}]),
        venta(jefe["id"], t, [item_pase("pase_clase", 12000)], tipo_medio="otro", metodo="Datáfono"),
        egreso(jefe["id"], t, 8000),
    ]
    # Efectivo esperado: 50.000 + 6.000 + 5.000 − 8.000 = 53.000
    ops.append(cerrar(jefe["id"], t, contado=53000, esperado=53000))
    res = await enviar(cliente, he, *ops)
    assert [r["resultado"] for r in res] == ["aplicada"] * 6, res

    turno = await _resumen(cliente, hj, t["id"])
    assert turno["estado"] == "cerrado"
    assert turno["estacion_nombre"] == estacion["nombre"]
    assert float(turno["base_inicial"]) == 50000
    assert float(turno["ventas_efectivo"]) == 11000
    assert float(turno["ventas_otro"]) == 22000
    assert float(turno["egresos_efectivo"]) == 8000
    assert float(turno["total_esperado_efectivo"]) == 53000
    assert float(turno["diferencia"]) == 0

    # Stock descontado y el pase de día deja entrar hoy.
    assert (await sql(gym.id, "SELECT stock FROM platform.productos WHERE id = :p", {"p": pid}))[0]["stock"] == 8
    r = await cliente.post(f"{API}/control-ingreso/checkin-manual", json={"deportista_id": dep}, headers=hj)
    assert r.status_code in (200, 201), r.text
    assert r.json()["resultado"] == "abrio"

    # Reenviar todo (respuesta perdida) no duplica nada.
    res = await enviar(cliente, he, *ops)
    assert {r["resultado"] for r in res} == {"duplicada"}
    conteos = (await sql(gym.id, """SELECT (SELECT count(*) FROM platform.ventas) v, (SELECT count(*) FROM platform.egresos_caja) e,
                                           (SELECT count(*) FROM platform.turnos_caja) t, (SELECT count(*) FROM platform.cobro_medios) m"""))[0]
    assert conteos == {"v": 3, "e": 1, "t": 1, "m": 2}
    assert (await sql(gym.id, "SELECT stock FROM platform.productos WHERE id = :p", {"p": pid}))[0]["stock"] == 8
    auditoria = await u.acciones_auditoria(gym.id)
    assert sum(1 for a in auditoria if a["accion"] == "REGISTRAR_VENTA_ESTACION") == 3


async def test_turno_simultaneo_con_la_web_se_registra_y_queda_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    # La estación abrió sin red a las 8; la web abrió el suyo después, con red.
    t = abrir(jefe["id"], base=20000, sin_confirmar=True)
    t["ocurrida_en"] = (ahora() - timedelta(hours=2)).isoformat()
    r = await cliente.post(f"{API}/caja/turnos/abrir", json={"base_inicial": 10000}, headers=hj)
    assert r.status_code == 201, r.text
    turno_web = r.json()["id"]

    v = venta(jefe["id"], t, [item_pase("pase_clase", 12000)])
    res = await enviar(cliente, he, t, v)
    assert res[0]["resultado"] == "pendiente_revision"
    assert res[0]["revision"]["motivo_codigo"] == "TURNO_SIMULTANEO"
    assert res[1]["resultado"] == "aplicada", res[1]
    rev = (await _revisiones(gym.id))[0]
    assert rev["entidad"] == "turnos_caja" and rev["entidad_id"] == t["id"]
    assert rev["detalle"]["otros_turnos"][0]["turno_id"] == turno_web
    assert "la web" in rev["motivo"]

    # Los dos turnos existen y cada uno se cierra con su propio arqueo.
    abiertos = await sql(gym.id, "SELECT id::text, estacion_id IS NOT NULL AS de_estacion FROM platform.turnos_caja WHERE estado = 'abierto'")
    assert {a["id"] for a in abiertos} == {t["id"], turno_web}
    assert (await enviar(cliente, he, cerrar(jefe["id"], t, contado=32000, esperado=32000)))[0]["resultado"] == "aplicada"
    r = await cliente.post(f"{API}/caja/turnos/cerrar", json={"efectivo_contado": 10000}, headers=hj)
    assert r.status_code == 200, r.text
    assert float(r.json()["diferencia"]) == 0


async def test_con_el_turno_en_la_estacion_la_web_no_cobra_ni_abre(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    t = abrir(jefe["id"])
    assert (await enviar(cliente, he, t))[0]["resultado"] == "aplicada"
    mensaje = f"La caja está abierta en la estación {estacion['nombre']}"

    r = await cliente.post(f"{API}/caja/turnos/abrir", json={"base_inicial": 0}, headers=hj)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "CAJA_EN_ESTACION"
    assert r.json()["error"]["mensaje"] == mensaje
    clave = {"X-Idempotency-Key": str(uuid4())}
    r = await cliente.post(f"{API}/caja/ventas", json={"metodo": "Efectivo", "tipo_medio": "efectivo",
                           "items": [{"tipo": "pase_clase", "descripcion": "Pase", "cantidad": 1, "precio_unitario": 1000}]},
                           headers={**hj, **clave})
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "CAJA_EN_ESTACION"
    r = await cliente.post(f"{API}/caja/egresos", json={"monto": 1000, "motivo": "Hielo"}, headers=hj)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "CAJA_EN_ESTACION"
    r = await cliente.post(f"{API}/caja/turnos/cerrar", json={"efectivo_contado": 0}, headers=hj)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "CAJA_EN_ESTACION"

    actual = (await cliente.get(f"{API}/caja/turnos/actual", headers=hj)).json()
    assert actual["id"] == t["id"] and actual["estacion_nombre"] == estacion["nombre"] and actual["es_propio"] is False
    r = await cliente.post(f"{API}/caja/turnos/{t['id']}/cerrar-ajeno", json={"conteo_efectivo": 0}, headers=hj)
    assert r.status_code == 409 and r.json()["error"]["codigo"] == "TURNO_DE_ESTACION"

    # La estación consulta en línea antes de abrir: ve su propio turno.
    r = await cliente.get(f"{API}/sync/caja/turno-abierto", headers=he)
    assert r.json()["abierto"] is True and r.json()["es_de_esta_estacion"] is True


async def test_cierre_forzado_y_lo_que_la_estacion_sigue_cobrando(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    t = abrir(jefe["id"], base=10000)
    assert (await enviar(cliente, he, t))[0]["resultado"] == "aplicada"
    r = await cliente.post(f"{API}/caja/turnos/{t['id']}/cierre-forzado", json={"motivo": "La estación no responde"}, headers=hj)
    assert r.status_code == 200, r.text

    # Sin red, la estación siguió cobrando y después cerró con su arqueo.
    v = venta(jefe["id"], t, [item_pase("pase_clase", 12000)])
    e = egreso(jefe["id"], t, 2000)
    c = cerrar(jefe["id"], t, contado=20000, esperado=20000)
    res = await enviar(cliente, he, v, e, c)
    assert [r["resultado"] for r in res] == ["pendiente_revision"] * 3
    assert {r["revision"]["motivo_codigo"] for r in res} == {"TURNO_CERRADO_EN_SERVIDOR"}
    # Nada se perdió: la venta y el egreso están en el turno de la estación, y el cierre forzado no cambió.
    assert (await sql(gym.id, "SELECT count(*) n FROM platform.ventas WHERE turno_id = :t", {"t": t["id"]}))[0]["n"] == 1
    assert (await sql(gym.id, "SELECT count(*) n FROM platform.egresos_caja WHERE turno_id = :t", {"t": t["id"]}))[0]["n"] == 1
    fila = (await sql(gym.id, "SELECT cierre_forzado, efectivo_contado FROM platform.turnos_caja WHERE id = :t", {"t": t["id"]}))[0]
    assert fila["cierre_forzado"] is True and fila["efectivo_contado"] is None
    revs = await _revisiones(gym.id)
    assert revs[-1]["detalle"]["efectivo_contado_estacion"] == 20000


async def test_stock_negativo_precio_distinto_y_descuento_fuera_de_regla(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    pid = await producto(gym.id, stock=1, precio=3500)  # la estación aún tenía 3.000
    t = abrir(jefe["id"])
    v = venta(jefe["id"], t, [item_producto(pid, precio=3000, cantidad=3, cobrado=2000, motivo="Cliente frecuente")])
    res = await enviar(cliente, he, t, v)
    assert res[1]["resultado"] == "pendiente_revision", res[1]
    rev = (await _revisiones(gym.id))[0]
    codigos = {rev["motivo_codigo"]} | {o["motivo_codigo"] for o in rev["detalle"].get("otros_motivos", [])}
    assert codigos == {"PRECIO_DISTINTO", "DESCUENTO_FUERA_DE_REGLA", "STOCK_NEGATIVO"}
    assert rev["entidad"] == "ventas" and rev["entidad_id"] == v["id"]
    # Se registró tal cual: 3 × 2.000 y el stock quedó en −2.
    venta_db = (await sql(gym.id, "SELECT total FROM platform.ventas WHERE id = :v", {"v": v["id"]}))[0]
    assert float(venta_db["total"]) == 6000
    assert (await sql(gym.id, "SELECT stock FROM platform.productos WHERE id = :p", {"p": pid}))[0]["stock"] == -2

    # Si la respuesta se perdió, el reenvío vuelve como duplicada con el mismo motivo, y no descuenta otra vez.
    otra = await enviar(cliente, he, v)
    assert otra[0]["resultado"] == "duplicada" and otra[0]["resultado_original"] == "pendiente_revision"
    assert otra[0]["revision"]["motivo_codigo"] == rev["motivo_codigo"]
    assert (await sql(gym.id, "SELECT stock FROM platform.productos WHERE id = :p", {"p": pid}))[0]["stock"] == -2


async def test_descuento_dentro_de_la_regla_se_aplica(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    await sql(gym.id, "UPDATE platform.tenant SET permitir_descuentos = true, tope_descuento_pct = 20 WHERE id = :g", {"g": gym.id})
    pid = await producto(gym.id, stock=5, precio=10000)
    t = abrir(jefe["id"])
    v = venta(jefe["id"], t, [item_producto(pid, precio=10000, cobrado=8000, motivo="Promoción")])
    res = await enviar(cliente, he, t, v)
    assert [r["resultado"] for r in res] == ["aplicada", "aplicada"], res
    item = (await sql(gym.id, "SELECT descuento_pct, motivo_descuento FROM platform.venta_items WHERE venta_id = :v", {"v": v["id"]}))[0]
    assert float(item["descuento_pct"]) == 20 and item["motivo_descuento"] == "Promoción"


async def test_contenido_mal_formado_no_guarda_nada(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    t = abrir(jefe["id"])
    malo = venta(jefe["id"], t, [item_pase("pase_clase", 12000)])
    malo["payload"]["total"] = 99999
    sin_cliente = venta(jefe["id"], t, [item_pase("pase_dia", 15000)])
    huerfana = venta(jefe["id"], {"id": str(uuid4())}, [item_pase("pase_clase", 12000)])
    huerfana["depende_de"] = []
    res = await enviar(cliente, he, t, malo, sin_cliente, huerfana)
    assert [r["resultado"] for r in res] == ["aplicada", "invalida", "invalida", "invalida"]
    assert [r["codigo"] for r in res[1:]] == ["TOTAL_NO_CUADRA", "PASE_DIA_REQUIERE_CLIENTE", "TURNO_DESCONOCIDO"]
    assert (await sql(gym.id, "SELECT count(*) n FROM platform.ventas"))[0]["n"] == 0


async def test_consulta_de_turno_abierto_y_precios_en_la_descarga(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, hj, estacion, he = await estacion_activa(cliente, fabrica)
    await sql(gym.id, "UPDATE platform.tenant SET precio_pase_dia = 15000 WHERE id = :g", {"g": gym.id})
    r = await cliente.get(f"{API}/sync/caja/turno-abierto", headers=he)
    assert r.status_code == 200 and r.json()["abierto"] is False
    assert (await cliente.post(f"{API}/caja/turnos/abrir", json={"base_inicial": 0}, headers=hj)).status_code == 201
    r = await cliente.get(f"{API}/sync/caja/turno-abierto", headers=he)
    assert r.json()["abierto"] is True and r.json()["es_de_esta_estacion"] is False and r.json()["donde"] == "la web"

    cambios, _, _ = await u.descargar_todo(cliente, he)
    g = cambios["gimnasio"][0]
    assert g["precio_pase_dia"] == 15000 and g["precio_pase_clase"] is None
