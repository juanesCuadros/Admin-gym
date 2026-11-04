"""Tanda 3: landing pública del gimnasio, imágenes subidas y encargado de la sede."""
import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import ADMIN_URL, Fabrica, login

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


async def _jefe(cliente: AsyncClient, fabrica: Fabrica, **gym_kwargs):
    gym = await fabrica.crear_gimnasio(**gym_kwargs)
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    return gym, {"Authorization": f"Bearer {tok}"}


async def _info(cliente: AsyncClient, headers: dict) -> dict:
    return (await cliente.get("/api/v1/my-gym/info", headers=headers)).json()


async def _subir(cliente: AsyncClient, headers: dict, tipo: str, contenido: bytes, nombre: str = "a.png"):
    return await cliente.post(f"/api/v1/my-gym/imagen/{tipo}", files={"archivo": (nombre, contenido)}, headers=headers)


@pytest.mark.asyncio
async def test_landing_publica_solo_trae_datos_publicos(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    info = await _info(cliente, headers)
    r = await cliente.put(
        "/api/v1/my-gym/info",
        json={
            "version": info["version"],
            "nombre": info["nombre"],
            "direccion": "Carrera 15 # 85-30",
            "ciudad": "Bogotá",
            "encargado_nombre": "Laura Encargada",
            "redes": {"instagram": "@gimnasio"},
            "horarios": {"lunes_viernes": "5:00 a 22:00"},
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["encargado_nombre"] == "Laura Encargada"
    r = await cliente.patch(
        "/api/v1/my-gym/branding",
        json={"version": r.json()["version"], "landing_titulo": "Entrena con nosotros", "landing_descripcion": "Abierto todos los días"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert (await cliente.post("/api/v1/planes", json={"nombre": "Mes", "precio": 80000, "duracion_dias": 30, "tipo": "individual"}, headers=headers)).status_code == 201
    inactivo = await cliente.post("/api/v1/planes", json={"nombre": "Viejo", "precio": 1000, "duracion_dias": 30, "tipo": "individual"}, headers=headers)
    assert (await cliente.patch(f"/api/v1/planes/{inactivo.json()['id']}/estado", json={"activo": False}, headers=headers)).status_code == 200
    assert (await cliente.post("/api/v1/clases/catalogo", json={"nombre": "Zumba"}, headers=headers)).status_code == 201

    # Sin sesión
    r = await cliente.get(f"/api/v1/my-gym/public-landing/{gym.subdominio}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["titulo"] == "Entrena con nosotros"
    assert d["horarios"] == {"lunes_viernes": "5:00 a 22:00"}
    assert [p["nombre"] for p in d["planes"]] == ["Mes"]
    assert [c["nombre"] for c in d["clases"]] == ["Zumba"]
    assert set(d["planes"][0]) == {"nombre", "precio", "duracion_dias", "cupo_personas"}
    prohibidos = {"id", "version", "encargado_nombre", "metodos_pago", "dias_gracia_mora", "precio_pase_dia", "pantalla_config"}
    assert prohibidos.isdisjoint(d)


@pytest.mark.asyncio
async def test_agenda_publica_solo_trae_lo_programado_de_la_semana(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    engine = create_async_engine(ADMIN_URL)
    async with engine.begin() as con:
        await con.execute(text("SET session_replication_role = replica"))
        for nombre, cuando, estado in (
            ("Zumba", "now() + interval '1 day'", "programada"),
            ("Pasada", "now() - interval '1 day'", "programada"),
            ("Cancelada", "now() + interval '2 days'", "cancelada"),
            ("Lejana", "now() + interval '20 days'", "programada"),
        ):
            await con.execute(
                text(
                    "INSERT INTO platform.clases (gimnasio_id, nombre, profesor_externo, cupo, fecha_hora, estado) "
                    f"VALUES (:g, :n, 'Instructora Secreta', 10, {cuando}, :e)"
                ),
                {"g": gym.id, "n": nombre, "e": estado},
            )
    await engine.dispose()
    r = await cliente.get(f"/api/v1/my-gym/public-landing/{gym.subdominio}")
    assert r.status_code == 200, r.text
    assert [c["nombre"] for c in r.json()["agenda"]] == ["Zumba"]
    assert set(r.json()["agenda"][0]) == {"nombre", "fecha_hora"}
    assert "Instructora Secreta" not in r.text


@pytest.mark.asyncio
async def test_landing_de_gimnasio_inexistente_o_suspendido(cliente: AsyncClient, fabrica: Fabrica):
    r = await cliente.get("/api/v1/my-gym/public-landing/no-existe-este-gym")
    assert r.status_code == 404
    gym = await fabrica.crear_gimnasio(activo=False)
    r = await cliente.get(f"/api/v1/my-gym/public-landing/{gym.subdominio}")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_subir_ver_y_quitar_imagen(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    version = (await _info(cliente, headers))["version"]

    r = await _subir(cliente, headers, "logo", PNG)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == version + 1
    url = r.json()["branding"]["logo_url"]
    assert url.startswith(f"/api/v1/my-gym/public-imagen/{gym.subdominio}/logo?v=")

    r = await cliente.get(url)
    assert r.status_code == 200
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"

    # Reemplazar cambia la URL para que el navegador no muestre la anterior.
    r = await _subir(cliente, headers, "logo", JPG, "b.jpg")
    assert r.json()["branding"]["logo_url"] != url
    assert (await cliente.get(r.json()["branding"]["logo_url"])).headers["content-type"] == "image/jpeg"
    assert (await cliente.get(f"/api/v1/my-gym/public-branding/{gym.subdominio}")).json()["logo_url"]

    r = await cliente.delete("/api/v1/my-gym/imagen/logo", headers=headers)
    assert r.status_code == 200, r.text
    assert "logo_url" not in r.json()["branding"]
    assert (await cliente.get(f"/api/v1/my-gym/public-imagen/{gym.subdominio}/logo")).status_code == 404


@pytest.mark.asyncio
async def test_rechaza_lo_que_no_es_imagen_o_pesa_demasiado(cliente: AsyncClient, fabrica: Fabrica):
    _, headers = await _jefe(cliente, fabrica)
    r = await _subir(cliente, headers, "banner", SVG, "x.svg")
    assert r.status_code == 422
    assert r.json()["error"]["codigo"] == "IMAGEN_NO_VALIDA"
    r = await _subir(cliente, headers, "banner", b"esto no es una imagen", "x.png")
    assert r.status_code == 422
    r = await _subir(cliente, headers, "banner", PNG + b"\x00" * (3 * 1024 * 1024), "grande.png")
    assert r.status_code == 413
    assert r.json()["error"]["codigo"] == "IMAGEN_MUY_GRANDE"
    r = await _subir(cliente, headers, "otra", PNG)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_subir_exige_sesion_y_permiso(cliente: AsyncClient, fabrica: Fabrica):
    gym, _ = await _jefe(cliente, fabrica)
    r = await cliente.post("/api/v1/my-gym/imagen/logo", files={"archivo": ("a.png", PNG)})
    assert r.status_code == 401
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    tok = (await login(cliente, gym, recepcion)).json()["access_token"]
    r = await _subir(cliente, {"Authorization": f"Bearer {tok}"}, "logo", PNG)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_las_imagenes_no_se_cruzan_entre_gimnasios(cliente: AsyncClient, fabrica: Fabrica):
    gym_a, headers_a = await _jefe(cliente, fabrica)
    gym_b, _ = await _jefe(cliente, fabrica)
    assert (await _subir(cliente, headers_a, "logo", PNG)).status_code == 200
    assert (await cliente.get(f"/api/v1/my-gym/public-imagen/{gym_a.subdominio}/logo")).status_code == 200
    assert (await cliente.get(f"/api/v1/my-gym/public-imagen/{gym_b.subdominio}/logo")).status_code == 404


@pytest.mark.asyncio
async def test_el_enlace_del_gimnasio_no_usa_un_dominio_ajeno(cliente: AsyncClient, fabrica: Fabrica):
    gym, headers = await _jefe(cliente, fabrica)
    d = (await cliente.get("/api/v1/my-gym/landing", headers=headers)).json()
    assert "gymos.io" not in d["landing_url"]
    assert gym.subdominio in d["landing_url"]
