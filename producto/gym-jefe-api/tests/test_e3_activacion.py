"""Escritorio · activación de la estación y primer ingreso del personal desde ella."""
import pytest
from httpx import AsyncClient

from app.core.security import hash_token
from tests.conftest import Fabrica
from tests.sync_util import (
    API,
    acciones_auditoria,
    activar,
    bloquear_gimnasio,
    cod,
    crear_estacion,
    estacion_activa,
    gimnasio_con_jefe,
    sql,
)

pytestmark = pytest.mark.asyncio

ACTIVAR = f"{API}/sync/activar"
SESION = f"{API}/sync/sesion-staff"


def _pedido(gym, codigo: str) -> dict:
    return {"subdominio": gym.subdominio, "codigo": codigo, "nombre_equipo": "PC-RECEPCION", "version_app": "0.1.0"}


async def test_activar_entrega_el_token_una_vez_y_el_servidor_guarda_solo_su_hash(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers, "Recepción")

    r = await cliente.post(ACTIVAR, json=_pedido(gym, estacion["codigo"]))
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["estacion_id"] == estacion["id"]
    assert cuerpo["gimnasio"] == {"id": str(gym.id), "nombre": gym.nombre, "subdominio": gym.subdominio}

    fila = (await sql(gym.id, "SELECT device_token_hash, codigo_hash, activada_en, nombre_equipo FROM platform.estaciones"))[0]
    assert fila["device_token_hash"] == hash_token(cuerpo["device_token"])
    assert fila["codigo_hash"] is None and fila["activada_en"] is not None and fila["nombre_equipo"] == "PC-RECEPCION"

    auditoria = await acciones_auditoria(gym.id)
    assert "ACTIVAR_ESTACION" in [a["accion"] for a in auditoria]
    assert cuerpo["device_token"] not in str(auditoria)

    listado = (await cliente.get(f"{API}/estaciones", headers=headers)).json()
    assert listado[0]["estado"] == "activa" and "device_token" not in listado[0]


async def test_el_codigo_sirve_una_sola_vez(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers)
    await activar(cliente, gym, estacion)
    r = await cliente.post(ACTIVAR, json=_pedido(gym, estacion["codigo"]))
    assert r.status_code == 404 and cod(r) == "CODIGO_INVALIDO"


async def test_el_codigo_se_acepta_sin_guion_y_en_minusculas(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers)
    r = await cliente.post(ACTIVAR, json=_pedido(gym, estacion["codigo"].replace("-", "").lower()))
    assert r.status_code == 200, r.text


async def test_codigo_errado_vencido_ajeno_o_subdominio_inexistente_responden_lo_mismo(cliente: AsyncClient, fabrica: Fabrica):
    a, _, headers_a = await gimnasio_con_jefe(cliente, fabrica)
    b, _, headers_b = await gimnasio_con_jefe(cliente, fabrica)
    de_a = await crear_estacion(cliente, headers_a)
    vencida = await crear_estacion(cliente, headers_b)
    await sql(b.id, "UPDATE platform.estaciones SET codigo_expira_en = now() - interval '1 minute'")

    respuestas = [
        await cliente.post(ACTIVAR, json=_pedido(a, "ZZZZ-ZZZZ")),
        await cliente.post(ACTIVAR, json=_pedido(b, vencida["codigo"])),
        await cliente.post(ACTIVAR, json=_pedido(b, de_a["codigo"])),
        await cliente.post(ACTIVAR, json={**_pedido(a, de_a["codigo"]), "subdominio": "no-existe-este-gym"}),
    ]
    assert {r.status_code for r in respuestas} == {404}
    assert len({r.text for r in respuestas}) == 1 and cod(respuestas[0]) == "CODIGO_INVALIDO"
    # El código de A sigue sirviendo en A: los intentos ajenos no lo gastaron.
    assert (await cliente.post(ACTIVAR, json=_pedido(a, de_a["codigo"]))).status_code == 200


async def test_cinco_intentos_fallidos_bloquean_la_activacion_15_minutos(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers)
    for _ in range(5):
        assert (await cliente.post(ACTIVAR, json=_pedido(gym, "AAAA-AAAA"))).status_code == 404
    r = await cliente.post(ACTIVAR, json=_pedido(gym, estacion["codigo"]))
    assert r.status_code == 429 and cod(r) == "ACTIVACION_BLOQUEADA"

    await sql(gym.id, "UPDATE platform.sync_intentos_activacion SET created_at = now() - interval '16 minutes'")
    assert (await cliente.post(ACTIVAR, json=_pedido(gym, estacion["codigo"]))).status_code == 200


async def test_un_gimnasio_bloqueado_no_activa_estaciones(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, headers = await gimnasio_con_jefe(cliente, fabrica)
    estacion = await crear_estacion(cliente, headers)
    await bloquear_gimnasio(fabrica, gym)
    r = await cliente.post(ACTIVAR, json=_pedido(gym, estacion["codigo"]))
    assert r.status_code == 403 and cod(r) == "GIMNASIO_SUSPENDIDO"


async def test_sin_token_con_token_inventado_o_revocada_no_entra(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers_jefe, estacion, headers_estacion = await estacion_activa(cliente, fabrica)
    cuerpo = {"correo": jefe["correo"], "password": jefe["password"]}

    r = await cliente.post(SESION, json=cuerpo)
    assert r.status_code == 401 and cod(r) == "ESTACION_NO_AUTORIZADA"
    r = await cliente.post(SESION, json=cuerpo, headers={"Authorization": "Bearer token-inventado"})
    assert r.status_code == 401 and cod(r) == "ESTACION_NO_AUTORIZADA"
    # El token de sesión de una persona no sirve como token de estación.
    r = await cliente.post(SESION, json=cuerpo, headers=headers_jefe)
    assert r.status_code == 401 and cod(r) == "ESTACION_NO_AUTORIZADA"

    assert (await cliente.post(SESION, json=cuerpo, headers=headers_estacion)).status_code == 200
    r = await cliente.post(f"{API}/estaciones/{estacion['id']}/revocar", json={"motivo": "Equipo robado"}, headers=headers_jefe)
    assert r.status_code == 200, r.text
    r = await cliente.post(SESION, json=cuerpo, headers=headers_estacion)
    assert r.status_code == 401 and cod(r) == "ESTACION_REVOCADA"


async def test_el_primer_ingreso_valida_la_contrasena_en_el_servidor_y_no_devuelve_hashes(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers_estacion = await estacion_activa(cliente, fabrica)
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")

    r = await cliente.post(SESION, json={"correo": recepcion["correo"].upper(), "password": recepcion["password"]}, headers=headers_estacion)
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["staff"]["id"] == str(recepcion["id"]) and cuerpo["staff"]["rol"] == "recepcionista"
    assert isinstance(cuerpo["permisos"], list)
    assert "hash" not in r.text and "argon2" not in r.text
    assert "INICIAR_SESION_ESTACION" in [a["accion"] for a in await acciones_auditoria(gym.id)]


async def test_contrasena_errada_persona_desactivada_o_de_otro_gimnasio_responden_lo_mismo(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers_estacion = await estacion_activa(cliente, fabrica)
    otro = await fabrica.crear_gimnasio()
    activa = await fabrica.crear_staff(gym)
    desactivada = await fabrica.crear_staff(gym, activo=False)
    ajena = await fabrica.crear_staff(otro)

    respuestas = [
        await cliente.post(SESION, json={"correo": activa["correo"], "password": "errada"}, headers=headers_estacion),
        await cliente.post(SESION, json={"correo": desactivada["correo"], "password": desactivada["password"]}, headers=headers_estacion),
        await cliente.post(SESION, json={"correo": ajena["correo"], "password": ajena["password"]}, headers=headers_estacion),
    ]
    assert {r.status_code for r in respuestas} == {401}
    assert len({r.text for r in respuestas}) == 1 and cod(respuestas[0]) == "CREDENCIALES_INVALIDAS"


async def test_cinco_contrasenas_erradas_bloquean_la_cuenta_tambien_desde_la_estacion(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers_estacion = await estacion_activa(cliente, fabrica)
    staff = await fabrica.crear_staff(gym)
    for _ in range(5):
        r = await cliente.post(SESION, json={"correo": staff["correo"], "password": "errada"}, headers=headers_estacion)
        assert r.status_code == 401
    r = await cliente.post(SESION, json={"correo": staff["correo"], "password": staff["password"]}, headers=headers_estacion)
    assert r.status_code == 429 and cod(r) == "CUENTA_BLOQUEADA_TEMPORALMENTE"


async def test_con_contrasena_temporal_primero_debe_cambiarla_en_la_web(cliente: AsyncClient, fabrica: Fabrica):
    gym, _, _, _, headers_estacion = await estacion_activa(cliente, fabrica)
    nueva = await fabrica.crear_staff(gym, debe_cambiar_password=True)
    r = await cliente.post(SESION, json={"correo": nueva["correo"], "password": nueva["password"]}, headers=headers_estacion)
    assert r.status_code == 409 and cod(r) == "DEBE_CAMBIAR_PASSWORD"


async def test_con_el_gimnasio_bloqueado_nadie_inicia_sesion_en_la_estacion(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, _, _, headers_estacion = await estacion_activa(cliente, fabrica)
    await bloquear_gimnasio(fabrica, gym)
    r = await cliente.post(SESION, json={"correo": jefe["correo"], "password": jefe["password"]}, headers=headers_estacion)
    assert r.status_code == 403 and cod(r) == "GIMNASIO_SUSPENDIDO"
