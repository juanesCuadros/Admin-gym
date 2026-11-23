"""Escritorio · descarga hacia la estación (`GET /sync/pull`)."""
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from tests.conftest import Fabrica
from tests.sync_util import API, bloquear_gimnasio, cod, estacion_activa, sql

pytestmark = pytest.mark.asyncio

PULL = f"{API}/sync/pull"


async def _deportista(gym_id, nombre="Ana Ruiz", documento=None, **extra) -> str:
    dep_id = uuid4()
    await sql(
        gym_id,
        """INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, telefono, correo)
           VALUES (:id, :g, 'CC', :doc, :nombre, '3001234567', 'privado@correo.co')""",
        {"id": dep_id, "g": gym_id, "doc": documento or uuid4().hex[:10], "nombre": nombre},
    )
    return str(dep_id)


async def _plan(gym_id, nombre=None, precio=80000) -> str:
    plan_id = uuid4()
    await sql(
        gym_id,
        "INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:id, :g, :n, :p, 30, 'individual')",
        {"id": plan_id, "g": gym_id, "n": nombre or f"Plan {uuid4().hex[:5]}", "p": precio},
    )
    return str(plan_id)


async def _todo(cliente: AsyncClient, headers: dict, cursor=None, limite=None) -> tuple[dict, list, str]:
    """Sigue la paginación hasta terminar la ronda. Devuelve (cambios por tabla, eliminados, cursor final)."""
    cambios, eliminados = {}, []
    for _ in range(200):
        params = {k: v for k, v in {"cursor": cursor, "limite": limite}.items() if v is not None}
        r = await cliente.get(PULL, params=params, headers=headers)
        assert r.status_code == 200, r.text
        cuerpo = r.json()
        for tabla, filas in cuerpo["cambios"].items():
            cambios.setdefault(tabla, []).extend(filas)
        eliminados.extend(cuerpo["eliminados"])
        cursor = cuerpo["cursor"]
        if not cuerpo["hay_mas"]:
            return cambios, eliminados, cursor
    raise AssertionError("la paginación no terminó")


async def test_la_descarga_inicial_trae_lo_del_gimnasio_y_nada_de_otro(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()
    dep = await _deportista(gym.id, "Ana Ruiz")
    plan = await _plan(gym.id, "Mensual", 80000)
    await _deportista(otro.id, "De Otro Gimnasio")
    await _plan(otro.id, "Plan Ajeno")
    mem_id = uuid4()
    await sql(
        gym.id,
        "INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento) VALUES (:id, :g, :d, :p, '2026-11-01', '2026-12-01')",
        {"id": mem_id, "g": gym.id, "d": dep, "p": plan},
    )
    await sql(gym.id, "INSERT INTO platform.productos (gimnasio_id, nombre, precio_compra, precio, stock) VALUES (:g, 'Agua', 1200, 3000, 24)", {"g": gym.id})

    cambios, eliminados, _ = await _todo(cliente, headers)

    assert [g["subdominio"] for g in cambios["gimnasio"]] == [gym.subdominio]
    assert cambios["gimnasio"][0]["dias_gracia_mora"] == 3
    assert [s["id"] for s in cambios["staff"]] == [str(jefe["id"])]
    assert cambios["deportistas"] == [
        {"id": dep, "tipo_documento": "CC", "documento": cambios["deportistas"][0]["documento"], "nombre": "Ana Ruiz", "activo": True, "eliminado": False,
         "salud": None}
    ]
    assert cambios["planes"] == [
        {"id": plan, "nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": True}
    ]
    assert cambios["productos"][0] == {**cambios["productos"][0], "nombre": "Agua", "precio": 3000, "stock": 24}
    assert cambios["membresias"][0].pop("created_at").endswith("+00:00")
    assert cambios["membresias"] == [
        {"id": str(mem_id), "deportista_id": dep, "plan_id": plan, "fecha_inicio": "2026-11-01", "fecha_vencimiento": "2026-12-01", "cancelada": False,
         "plan_precio_vendido": None}
    ]
    assert eliminados == []


async def test_no_salen_hashes_ni_contacto_ni_costos(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    await _deportista(gym.id)
    await sql(gym.id, "INSERT INTO platform.productos (gimnasio_id, nombre, precio_compra, precio, stock) VALUES (:g, 'Agua', 7771, 3000, 5)", {"g": gym.id})
    r = await cliente.get(PULL, headers=headers)
    for prohibido in ["hash", "argon2", "3001234567", "privado@correo.co", "precio_compra", "7771", "device_token", "fecha_nacimiento"]:
        assert prohibido not in r.text, prohibido


async def test_la_segunda_descarga_solo_trae_lo_que_cambio(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    ana = await _deportista(gym.id, "Ana")
    luis = await _deportista(gym.id, "Luis")
    _, _, cursor = await _todo(cliente, headers)

    cambios, _, cursor = await _todo(cliente, headers, cursor)
    assert cambios["deportistas"] == [] and cambios["planes"] == []

    await sql(gym.id, "UPDATE platform.deportistas SET activo = false WHERE id = :id", {"id": luis})
    cambios, _, cursor = await _todo(cliente, headers, cursor)
    assert [(d["id"], d["activo"]) for d in cambios["deportistas"]] == [(luis, False)]
    assert ana not in str(cambios)


async def test_la_paginacion_entrega_todo_sin_repetir_dentro_de_la_ronda(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    esperados = sorted([await _deportista(gym.id, f"Persona {i}") for i in range(7)])
    planes = sorted([await _plan(gym.id) for _ in range(3)])

    cambios, _, _ = await _todo(cliente, headers, limite=2)
    assert sorted(d["id"] for d in cambios["deportistas"]) == esperados
    assert sorted(p["id"] for p in cambios["planes"]) == planes
    assert len(cambios["gimnasio"]) == 1


async def test_un_plan_borrado_llega_como_eliminado(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    plan = await _plan(gym.id)
    _, _, cursor = await _todo(cliente, headers)
    await sql(gym.id, "DELETE FROM platform.planes WHERE id = :id", {"id": plan})
    _, eliminados, _ = await _todo(cliente, headers, cursor)
    assert eliminados == [{"tabla": "planes", "id": plan}]


async def test_una_transaccion_que_confirma_tarde_no_se_pierde(cliente: AsyncClient, fabrica: Fabrica):
    """
    El caso que rompe un cursor por fecha: A empieza y escribe, B escribe y confirma, la estación
    sincroniza, y A confirma después. El cambio de A tiene que llegar en la siguiente descarga.
    """
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    lenta = await _deportista(gym.id, "Transacción Lenta")
    rapida = await _deportista(gym.id, "Transacción Rápida")
    _, _, cursor = await _todo(cliente, headers)

    async with async_session_maker() as tx_a:
        await tx_a.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await tx_a.execute(text("UPDATE platform.deportistas SET nombre = 'Lenta Confirmada' WHERE id = :id"), {"id": lenta})
        # A sigue abierta. B escribe y confirma.
        await sql(gym.id, "UPDATE platform.deportistas SET nombre = 'Rápida Confirmada' WHERE id = :id", {"id": rapida})

        cambios, _, cursor = await _todo(cliente, headers, cursor)
        assert [d["nombre"] for d in cambios["deportistas"]] == ["Rápida Confirmada"]

        # La estación vuelve a sincronizar antes de que A confirme: el cursor no debe saltarse a A.
        cambios, _, cursor = await _todo(cliente, headers, cursor)
        assert "Lenta Confirmada" not in str(cambios)

        await tx_a.commit()

    cambios, _, cursor = await _todo(cliente, headers, cursor)
    assert "Lenta Confirmada" in [d["nombre"] for d in cambios["deportistas"]]

    # Y una vez entregado, deja de repetirse.
    cambios, _, _ = await _todo(cliente, headers, cursor)
    assert cambios["deportistas"] == []


async def test_personal_desactivado_eliminado_o_con_contrasena_cambiada_llega_marcado(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    a = await fabrica.crear_staff(gym)
    b = await fabrica.crear_staff(gym)
    c = await fabrica.crear_staff(gym)
    _, _, cursor = await _todo(cliente, headers)

    await sql(gym.id, "UPDATE platform.staff SET activo = false WHERE id = :id", {"id": a["id"]})
    await sql(gym.id, "UPDATE platform.staff SET deleted_at = now() WHERE id = :id", {"id": b["id"]})
    await sql(gym.id, "UPDATE platform.staff SET hash_password = 'otro' WHERE id = :id", {"id": c["id"]})

    cambios, _, _ = await _todo(cliente, headers, cursor)
    por_id = {s["id"]: s for s in cambios["staff"]}
    assert por_id[str(a["id"])]["activo"] is False
    assert por_id[str(b["id"])]["eliminado"] is True
    assert por_id[str(c["id"])]["password_cambiada_en"] is not None


async def test_trae_la_fecha_de_corte_para_que_la_estacion_calcule_el_bloqueo(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    async with fabrica.admin_engine.begin() as conn:
        await conn.execute(text("UPDATE superadmin.gimnasios SET fecha_corte = current_date - 2 WHERE gimnasio_id = :g"), {"g": gym.id})
    r = await cliente.get(PULL, headers=headers)
    assert r.status_code == 200, r.text
    suscripcion = r.json()["suscripcion"]
    assert suscripcion["estado_calculado"] == "en_gracia" and suscripcion["estado_guardado"] == "activo"
    assert suscripcion["fecha_corte"] is not None


async def test_gimnasio_bloqueado_no_descarga(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    await bloquear_gimnasio(fabrica, gym)
    r = await cliente.get(PULL, headers=headers)
    assert r.status_code == 403 and cod(r) == "GIMNASIO_SUSPENDIDO"
    assert r.json()["error"]["detalles"]["motivo"] == "falta_pago"


async def test_estacion_revocada_o_sin_token_no_descarga(cliente: AsyncClient, fabrica: Fabrica):
    _, _, headers_jefe, estacion, headers = await estacion_activa(cliente, fabrica)
    assert (await cliente.get(PULL)).status_code == 401
    r = await cliente.post(f"{API}/estaciones/{estacion['id']}/revocar", json={"motivo": "Equipo robado"}, headers=headers_jefe)
    assert r.status_code == 200
    r = await cliente.get(PULL, headers=headers)
    assert r.status_code == 401 and cod(r) == "ESTACION_REVOCADA"


async def test_cursor_dañado_se_rechaza_y_cursor_de_otra_epoca_reinicia(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await _deportista(gym.id)
    r = await cliente.get(PULL, params={"cursor": "esto-no-es-un-cursor"}, headers=headers)
    assert r.status_code == 422 and cod(r) == "CURSOR_INVALIDO"

    from app.modules.sync.pull import codificar_cursor

    viejo = codificar_cursor({"e": str(uuid4()), "d": 999999, "s": 999999, "t": 0, "u": None})
    r = await cliente.get(PULL, params={"cursor": viejo}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["reiniciar"] is True
    assert dep in [d["id"] for d in r.json()["cambios"]["deportistas"]]


async def test_cada_descarga_deja_la_fecha_de_ultima_sincronizacion(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    assert (await sql(gym.id, "SELECT ultima_sync_en FROM platform.estaciones"))[0]["ultima_sync_en"] is None
    r = await cliente.get(PULL, headers={**headers, "X-GymDesk-Version": "0.2.0"})
    assert r.status_code == 200
    fila = (await sql(gym.id, "SELECT ultima_sync_en, version_app FROM platform.estaciones"))[0]
    assert fila["ultima_sync_en"] is not None and fila["version_app"] == "0.2.0"


# --- Fase 2: lo que la regla de acceso necesita ---
async def test_llegan_los_congelamientos_y_su_borrado(cliente: AsyncClient, fabrica: Fabrica):
    from tests import sync_util as u

    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()
    dep = await u.deportista(gym.id)
    mem = await u.membresia(gym.id, dep, await u.plan(gym.id), vence_en_dias=20)
    cong = await u.congelamiento(gym.id, mem, desde_dias=-2)
    ajeno = await u.deportista(otro.id)
    await u.congelamiento(otro.id, await u.membresia(otro.id, ajeno, await u.plan(otro.id), vence_en_dias=20))

    cambios, _, cursor = await _todo(cliente, headers)
    assert [(c["id"], c["membresia_id"], c["fecha_fin"]) for c in cambios["congelamientos"]] == [(cong, mem, None)]
    assert set(cambios["congelamientos"][0]) == {"id", "membresia_id", "fecha_inicio", "fecha_fin"}

    await sql(gym.id, "DELETE FROM platform.congelamientos WHERE id = :id", {"id": cong})
    cambios, eliminados, _ = await _todo(cliente, headers, cursor)
    assert cambios["congelamientos"] == [] and {"tabla": "congelamientos", "id": cong} in eliminados


async def test_solo_bajan_los_pases_de_dia_recientes_con_cliente_y_la_anulacion_vuelve_a_bajar(cliente: AsyncClient, fabrica: Fabrica):
    from tests import sync_util as u

    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id)
    pase = await u.venta(gym.id, jefe["id"], dep, "pase_dia")
    await u.venta(gym.id, jefe["id"], dep, "pase_dia", hace_dias=5)      # viejo
    await u.venta(gym.id, jefe["id"], dep, "pase_clase")                 # no es pase de día
    await u.venta(gym.id, jefe["id"], None, "pase_clase")                # sin cliente

    cambios, _, cursor = await _todo(cliente, headers)
    assert [(p["id"], p["deportista_id"], p["anulada"]) for p in cambios["pases_dia"]] == [(pase, dep, False)]
    # Solo lo necesario: ni totales, ni medio de pago, ni quién la registró.
    assert set(cambios["pases_dia"][0]) == {"id", "deportista_id", "created_at", "anulada"}

    await sql(gym.id, "UPDATE platform.ventas SET anulada = true, motivo_anulacion = 'Error de digitación', anulada_en = now() WHERE id = :id", {"id": pase})
    cambios, _, _ = await _todo(cliente, headers, cursor)
    assert [(p["id"], p["anulada"]) for p in cambios["pases_dia"]] == [(pase, True)]
