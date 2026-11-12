"""Escritorio · envío desde la estación (`POST /sync/push`): sin duplicados, sin pérdidas."""
import asyncio
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.conftest import Fabrica
from tests.sync_util import API, acciones_auditoria, bloquear_gimnasio, cod, estacion_activa, sql

pytestmark = pytest.mark.asyncio

PUSH = f"{API}/sync/push"
PULL = f"{API}/sync/pull"


def evento(accion="INICIAR_SESION", staff_id=None, depende_de: Optional[list] = None, **detalle) -> dict:
    op_id = str(uuid4())
    return {
        "id": op_id,
        "tipo": "auditoria_estacion",
        "idempotency_key": f"est-{op_id}",
        "ocurrida_en": datetime(2026, 11, 12, 15, 30, tzinfo=timezone.utc).isoformat(),
        "staff_id": str(staff_id) if staff_id else None,
        "depende_de": depende_de or [],
        "payload": {"accion": accion, "entidad": "staff_local", "entidad_id": str(staff_id) if staff_id else None, "detalle": detalle},
    }


async def enviar(cliente: AsyncClient, headers: dict, *ops: dict) -> list:
    r = await cliente.post(PUSH, json={"operaciones": list(ops)}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["resultados"]


async def _eventos(gym_id) -> list:
    return [a for a in await acciones_auditoria(gym_id) if a["accion"].startswith("ESTACION_")]


async def _recibidas(gym_id) -> int:
    return (await sql(gym_id, "SELECT count(*) AS n FROM platform.sync_operaciones"))[0]["n"]


async def test_un_evento_de_la_estacion_queda_en_la_auditoria_del_gimnasio(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    op = evento("INICIAR_SESION", jefe["id"], metodo="pin")

    resultados = await enviar(cliente, headers, op)
    assert [(r["indice"], r["id"], r["resultado"]) for r in resultados] == [(0, op["id"], "aplicada")]

    registros = await _eventos(gym.id)
    assert len(registros) == 1
    assert registros[0]["accion"] == "ESTACION_INICIAR_SESION" and registros[0]["actor_nombre"] == "Staff jefe"
    assert registros[0]["detalle"]["metodo"] == "pin"
    # Se conserva la hora de la estación, no la de llegada.
    assert registros[0]["detalle"]["ocurrida_en"] == "2026-11-12T15:30:00+00:00"
    assert registros[0]["detalle"]["operacion_id"] == op["id"]


async def test_reenviar_la_misma_operacion_no_la_duplica_y_devuelve_el_resultado_original(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    op = evento("CREAR_PIN", jefe["id"])

    assert (await enviar(cliente, headers, op))[0]["resultado"] == "aplicada"
    for _ in range(3):
        repetida = (await enviar(cliente, headers, op))[0]
        assert repetida["resultado"] == "duplicada" and repetida["resultado_original"] == "aplicada"
        assert repetida["datos"] == {"accion": "CREAR_PIN"}

    # También si llega dos veces en el mismo lote.
    otra = evento("CERRAR_SESION", jefe["id"])
    assert [r["resultado"] for r in await enviar(cliente, headers, otra, otra)] == ["aplicada", "duplicada"]

    assert len(await _eventos(gym.id)) == 2 and await _recibidas(gym.id) == 2


async def test_dos_envios_simultaneos_de_la_misma_operacion_dejan_un_solo_registro(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    op = evento("INICIAR_SESION", jefe["id"])
    respuestas = await asyncio.gather(*[cliente.post(PUSH, json={"operaciones": [op]}, headers=headers) for _ in range(4)])
    assert {r.status_code for r in respuestas} == {200}
    resultados = sorted(r.json()["resultados"][0]["resultado"] for r in respuestas)
    assert resultados == ["aplicada", "duplicada", "duplicada", "duplicada"]
    assert len(await _eventos(gym.id)) == 1 and await _recibidas(gym.id) == 1


async def test_una_operacion_invalida_no_guarda_nada(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()
    ajeno = await fabrica.crear_staff(otro)

    accion_rara = evento("BORRAR_TODO", jefe["id"])
    tipo_raro = {**evento("INICIAR_SESION", jefe["id"]), "tipo": "tipo_que_no_existe"}
    sin_payload = {**evento("INICIAR_SESION", jefe["id"]), "payload": {"accion": "INICIAR_SESION"}}
    staff_ajeno = evento("INICIAR_SESION", ajeno["id"])
    mal_formada = {"id": str(uuid4()), "tipo": "auditoria_estacion"}
    sin_id = {"tipo": "auditoria_estacion", "payload": {}}

    resultados = await enviar(cliente, headers, accion_rara, tipo_raro, sin_payload, staff_ajeno, mal_formada, sin_id)
    assert [r["resultado"] for r in resultados] == ["invalida"] * 6
    assert [r["codigo"] for r in resultados] == [
        "ACCION_DESCONOCIDA", "TIPO_DESCONOCIDO", "PAYLOAD_INVALIDO", "STAFF_DESCONOCIDO", "OPERACION_MAL_FORMADA", "OPERACION_MAL_FORMADA",
    ]
    assert resultados[5]["id"] is None and resultados[5]["indice"] == 5
    assert await _eventos(gym.id) == [] and await _recibidas(gym.id) == 0


async def test_una_invalida_en_medio_no_impide_las_demas(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    resultados = await enviar(
        cliente, headers, evento("INICIAR_SESION", jefe["id"]), evento("NO_EXISTE", jefe["id"]), evento("CERRAR_SESION", jefe["id"])
    )
    assert [r["resultado"] for r in resultados] == ["aplicada", "invalida", "aplicada"]
    assert [e["accion"] for e in await _eventos(gym.id)] == ["ESTACION_INICIAR_SESION", "ESTACION_CERRAR_SESION"]


async def test_lo_que_depende_de_una_invalida_queda_retenido_y_no_se_procesa_suelto(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    a = evento("NO_EXISTE", jefe["id"])                              # inválida
    b = evento("CREAR_PIN", jefe["id"], depende_de=[a["id"]])        # depende de la inválida
    c = evento("CERRAR_SESION", jefe["id"], depende_de=[b["id"]])    # depende de una retenida
    d = evento("BLOQUEAR_SESION", jefe["id"])                        # independiente

    resultados = await enviar(cliente, headers, a, b, c, d)
    assert [r["resultado"] for r in resultados] == ["invalida", "retenida", "retenida", "aplicada"]
    assert resultados[1]["codigo"] == "DEPENDENCIA_PENDIENTE" and resultados[1]["datos"]["depende_de"] == [a["id"]]
    assert [e["accion"] for e in await _eventos(gym.id)] == ["ESTACION_BLOQUEAR_SESION"]
    assert await _recibidas(gym.id) == 1

    # Reenviar solo las retenidas no las cuela: su dependencia sigue sin resolverse.
    assert [r["resultado"] for r in await enviar(cliente, headers, b, c)] == ["retenida", "retenida"]

    # Corregida la primera (mismo id, contenido válido), entran las tres y en orden.
    a_corregida = {**a, "payload": {**a["payload"], "accion": "INICIAR_SESION"}}
    assert [r["resultado"] for r in await enviar(cliente, headers, a_corregida, b, c)] == ["aplicada"] * 3
    assert [e["accion"] for e in await _eventos(gym.id)] == [
        "ESTACION_BLOQUEAR_SESION", "ESTACION_INICIAR_SESION", "ESTACION_CREAR_PIN", "ESTACION_CERRAR_SESION",
    ]


async def test_una_dependencia_ya_recibida_en_un_envio_anterior_no_retiene(cliente: AsyncClient, fabrica: Fabrica):
    _, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    a = evento("INICIAR_SESION", jefe["id"])
    assert (await enviar(cliente, headers, a))[0]["resultado"] == "aplicada"
    b = evento("CERRAR_SESION", jefe["id"], depende_de=[a["id"]])
    assert (await enviar(cliente, headers, b))[0]["resultado"] == "aplicada"

    huerfana = evento("CERRAR_SESION", jefe["id"], depende_de=[str(uuid4())])
    assert (await enviar(cliente, headers, huerfana))[0]["resultado"] == "retenida"


async def test_el_mismo_id_con_otro_contenido_se_rechaza_sin_tocar_lo_ya_guardado(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    op = evento("INICIAR_SESION", jefe["id"])
    await enviar(cliente, headers, op)

    alterada = {**op, "payload": {**op["payload"], "accion": "CAMBIAR_PIN"}}
    r = (await enviar(cliente, headers, alterada))[0]
    assert (r["resultado"], r["codigo"]) == ("invalida", "OPERACION_ID_REUTILIZADO")

    misma_clave = {**evento("CERRAR_SESION", jefe["id"]), "idempotency_key": op["idempotency_key"]}
    r = (await enviar(cliente, headers, misma_clave))[0]
    assert (r["resultado"], r["codigo"]) == ("invalida", "CLAVE_IDEMPOTENCIA_EN_USO")
    assert [e["accion"] for e in await _eventos(gym.id)] == ["ESTACION_INICIAR_SESION"]


async def test_un_conflicto_se_registra_igual_y_queda_pendiente_de_revision(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers = await estacion_activa(cliente, fabrica)
    desactivada = await fabrica.crear_staff(gym, activo=False)
    op = evento("INICIAR_SESION", desactivada["id"], metodo="pin")

    r = (await enviar(cliente, headers, op))[0]
    assert r["resultado"] == "pendiente_revision"
    assert r["revision"]["motivo_codigo"] == "STAFF_DESACTIVADO"

    # Ya ocurrió: queda en la auditoría aunque el servidor no lo habría permitido.
    assert [e["accion"] for e in await _eventos(gym.id)] == ["ESTACION_INICIAR_SESION"]
    revision = (await sql(gym.id, "SELECT estado_revision, motivo_codigo, entidad, entidad_id, resolucion FROM platform.sync_revisiones"))[0]
    assert revision == {
        "estado_revision": "pendiente_revision", "motivo_codigo": "STAFF_DESACTIVADO",
        "entidad": "staff", "entidad_id": str(desactivada["id"]), "resolucion": None,
    }
    assert "SYNC_PENDIENTE_REVISION" in [a["accion"] for a in await acciones_auditoria(gym.id)]

    # El reenvío devuelve el mismo resultado y no abre otra revisión.
    repetida = (await enviar(cliente, headers, op))[0]
    assert (repetida["resultado"], repetida["resultado_original"]) == ("duplicada", "pendiente_revision")
    assert (await sql(gym.id, "SELECT count(*) AS n FROM platform.sync_revisiones"))[0]["n"] == 1


async def test_la_auditoria_recibida_no_guarda_contrasenas_ni_pin(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    op = evento("CREAR_PIN", jefe["id"], pin="4821", password="Secreta-123", metodo="contrasena")
    assert (await enviar(cliente, headers, op))[0]["resultado"] == "aplicada"
    guardado = str(await _eventos(gym.id))
    assert "4821" not in guardado and "Secreta-123" not in guardado and "contrasena" in guardado


async def test_con_el_gimnasio_bloqueado_el_envio_se_acepta_y_la_descarga_no(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    await bloquear_gimnasio(fabrica, gym)

    r = await cliente.get(PULL, headers=headers)
    assert r.status_code == 403 and cod(r) == "GIMNASIO_SUSPENDIDO"
    assert (await enviar(cliente, headers, evento("CERRAR_SESION", jefe["id"])))[0]["resultado"] == "aplicada"
    assert len(await _eventos(gym.id)) == 1


async def test_sin_token_o_con_la_estacion_revocada_no_se_recibe_nada(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers_jefe, estacion, headers = await estacion_activa(cliente, fabrica)
    cuerpo = {"operaciones": [evento("INICIAR_SESION", jefe["id"])]}
    assert (await cliente.post(PUSH, json=cuerpo)).status_code == 401

    await cliente.post(f"{API}/estaciones/{estacion['id']}/revocar", json={"motivo": "Equipo robado"}, headers=headers_jefe)
    r = await cliente.post(PUSH, json=cuerpo, headers=headers)
    assert r.status_code == 401 and cod(r) == "ESTACION_REVOCADA"
    assert await _eventos(gym.id) == []


async def test_las_operaciones_de_un_gimnasio_no_se_cruzan_con_las_de_otro(cliente: AsyncClient, fabrica: Fabrica):
    gym_a, jefe_a, _, _, headers_a = await estacion_activa(cliente, fabrica)
    gym_b, jefe_b, _, _, headers_b = await estacion_activa(cliente, fabrica)
    op_a = evento("INICIAR_SESION", jefe_a["id"])
    # Mismo identificador y misma clave, en otro gimnasio: es otra operación.
    op_b = {**op_a, "staff_id": str(jefe_b["id"]), "payload": {**op_a["payload"], "entidad_id": str(jefe_b["id"])}}

    assert (await enviar(cliente, headers_a, op_a))[0]["resultado"] == "aplicada"
    assert (await enviar(cliente, headers_b, op_b))[0]["resultado"] == "aplicada"
    assert len(await _eventos(gym_a.id)) == 1 and len(await _eventos(gym_b.id)) == 1
    assert await _recibidas(gym_a.id) == 1 and await _recibidas(gym_b.id) == 1


async def test_mas_de_50_operaciones_por_envio_se_rechaza(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers = await estacion_activa(cliente, fabrica)
    r = await cliente.post(PUSH, json={"operaciones": [evento("CERRAR_SESION", jefe["id"]) for _ in range(51)]}, headers=headers)
    assert r.status_code == 422
    assert await _recibidas(gym.id) == 0
    assert len(await enviar(cliente, headers, *[evento("CERRAR_SESION", jefe["id"]) for _ in range(50)])) == 50
