"""Escritorio · bandeja "Por revisar": la ve y la cierra el Jefe."""
import pytest
from httpx import AsyncClient

from tests import sync_util as u
from tests.conftest import Fabrica
from tests.sync_util import API, acciones_auditoria, cabeceras, cod, estacion_activa, gimnasio_con_jefe, sql
from tests.test_e6_sync_ingreso import enviar, op_ingreso

pytestmark = pytest.mark.asyncio

REVISIONES = f"{API}/sync/revisiones"


async def _con_un_ingreso_por_revisar(cliente: AsyncClient, fabrica: Fabrica):
    """Una estación dejó entrar a alguien que en el servidor está vencido."""
    gym, jefe, headers_jefe, estacion, headers_estacion = await estacion_activa(cliente, fabrica)
    dep = await u.deportista(gym.id, "Laura Gómez")
    await u.membresia(gym.id, dep, await u.plan(gym.id), vence_en_dias=-20)
    resultado = (await enviar(cliente, headers_estacion, op_ingreso(jefe["id"], dep)))[0]
    assert resultado["resultado"] == "pendiente_revision"
    return gym, jefe, headers_jefe, estacion


async def test_el_jefe_ve_lo_pendiente_con_el_motivo_la_estacion_y_quien_lo_registro(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers, estacion = await _con_un_ingreso_por_revisar(cliente, fabrica)

    r = await cliente.get(REVISIONES, headers=headers)
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert (cuerpo["total"], cuerpo["pendientes"]) == (1, 1)
    item = cuerpo["items"][0]
    assert (item["entidad"], item["tipo_operacion"], item["motivo_codigo"]) == ("checkins", "ingreso", "ACCESO_NO_COINCIDE")
    assert "Laura Gómez" in item["motivo"] and item["estacion_nombre"] == estacion["nombre"]
    assert item["registrado_por_nombre"] == "Staff jefe" and item["estado_revision"] == "pendiente_revision"
    assert item["resoluciones_posibles"] == ["visto"]


async def test_revisar_exige_nota_queda_en_auditoria_y_solo_se_hace_una_vez(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers, _ = await _con_un_ingreso_por_revisar(cliente, fabrica)
    revision_id = (await cliente.get(REVISIONES, headers=headers)).json()["items"][0]["id"]
    url = f"{REVISIONES}/{revision_id}/revisar"

    assert (await cliente.post(url, json={"resolucion": "visto", "nota": "ok"}, headers=headers)).status_code == 422
    assert (await cliente.post(url, json={"resolucion": "visto", "nota": "      "}, headers=headers)).status_code == 422
    # Aplicar, ajustar y anular son para dinero: aún no existen.
    assert (await cliente.post(url, json={"resolucion": "anular", "nota": "No debió entrar"}, headers=headers)).status_code == 422

    r = await cliente.post(url, json={"resolucion": "visto", "nota": "Hablé con Laura, renueva mañana"}, headers=headers)
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert (cuerpo["estado_revision"], cuerpo["resolucion"], cuerpo["nota_revision"]) == ("revisado", "visto", "Hablé con Laura, renueva mañana")
    assert cuerpo["revisado_por_nombre"] == "Staff jefe" and cuerpo["revisado_en"] and cuerpo["resoluciones_posibles"] == []

    registro = [a for a in await acciones_auditoria(gym.id) if a["accion"] == "REVISAR_SYNC"]
    assert len(registro) == 1 and registro[0]["detalle"]["nota"] == "Hablé con Laura, renueva mañana"

    otra = await cliente.post(url, json={"resolucion": "visto", "nota": "Segunda vez"}, headers=headers)
    assert otra.status_code == 409 and cod(otra) == "REVISION_YA_REVISADA"

    # Sale de pendientes y queda en el historial. El ingreso no cambió.
    assert (await cliente.get(REVISIONES, headers=headers)).json()["items"] == []
    revisadas = (await cliente.get(REVISIONES, params={"estado": "revisado"}, headers=headers)).json()
    assert (revisadas["total"], revisadas["pendientes"]) == (1, 0)
    assert [c["resultado"] for c in await sql(gym.id, "SELECT resultado FROM platform.checkins")] == ["abrio"]


async def test_solo_el_jefe_y_solo_las_de_su_gimnasio(cliente: AsyncClient, fabrica: Fabrica):
    gym, jefe, headers, _ = await _con_un_ingreso_por_revisar(cliente, fabrica)
    revision_id = (await cliente.get(REVISIONES, headers=headers)).json()["items"][0]["id"]
    url = f"{REVISIONES}/{revision_id}/revisar"
    cuerpo = {"resolucion": "visto", "nota": "Intento ajeno"}

    recepcion = await cabeceras(cliente, gym, await fabrica.crear_staff(gym, rol="recepcionista"))
    assert (await cliente.get(REVISIONES, headers=recepcion)).status_code == 403
    assert (await cliente.post(url, json=cuerpo, headers=recepcion)).status_code == 403

    _, _, headers_otro = await gimnasio_con_jefe(cliente, fabrica)
    assert (await cliente.get(REVISIONES, headers=headers_otro)).json()["items"] == []
    ajena = await cliente.post(url, json=cuerpo, headers=headers_otro)
    assert ajena.status_code == 404 and cod(ajena) == "REVISION_NO_ENCONTRADA"

    # Sin sesión de una persona no se revisa nada.
    assert (await cliente.get(REVISIONES)).status_code in (401, 403)
