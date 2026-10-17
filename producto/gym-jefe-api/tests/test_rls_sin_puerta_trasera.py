"""
Migración 040 · RLS sin "puerta trasera".

Antes, una sesión de gymos_platform sin app.gimnasio_id fijado veía las filas de TODOS los gimnasios.
Ahora no ve ni escribe nada; las rutas sin sesión (login, refresh, recuperación, branding, Pantalla TV)
resuelven su gimnasio con funciones acotadas. Corren contra PostgreSQL real.
"""
from uuid import uuid4

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.contexto_gimnasio import fijar_gimnasio
from app.core.database import async_session_maker
from app.main import app
from tests.conftest import login


async def test_sin_gimnasio_fijado_no_se_ve_nada(fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    async with async_session_maker() as s:
        tenants = (await s.execute(text("SELECT count(*) FROM platform.tenant WHERE id = :g"), {"g": gym.id})).scalar()
        staff = (await s.execute(text("SELECT count(*) FROM platform.staff WHERE id = :s"), {"s": st["id"]})).scalar()
    assert tenants == 0
    assert staff == 0


async def test_un_gimnasio_no_ve_al_otro(fabrica):
    gym_a = await fabrica.crear_gimnasio()
    gym_b = await fabrica.crear_gimnasio()
    st_b = await fabrica.crear_staff(gym_b)

    async with async_session_maker() as s:
        await fijar_gimnasio(s, gym_a.id)
        tenant_b = (await s.execute(text("SELECT count(*) FROM platform.tenant WHERE id = :g"), {"g": gym_b.id})).scalar()
        staff_b = (await s.execute(text("SELECT count(*) FROM platform.staff WHERE id = :s"), {"s": st_b["id"]})).scalar()
    assert tenant_b == 0
    assert staff_b == 0


async def test_sin_gimnasio_fijado_no_se_puede_escribir(fabrica):
    gym = await fabrica.crear_gimnasio()

    async with async_session_maker() as s:
        try:
            await s.execute(
                text("""
                    INSERT INTO platform.staff (id, gimnasio_id, nombre, correo, hash_password, rol, activo)
                    VALUES (:id, :g, 'Intruso', :correo, 'x', 'recepcionista', true)
                """),
                {"id": uuid4(), "g": gym.id, "correo": f"intruso-{uuid4().hex[:6]}@t15-gymos.com"},
            )
            await s.commit()
            escribio = True
        except Exception as e:
            await s.rollback()
            assert "row-level security" in str(e)
            escribio = False
    assert escribio is False


async def test_catalogo_global_de_ejercicios_sigue_visible(fabrica):
    gym = await fabrica.crear_gimnasio()
    async with async_session_maker() as s:
        await fijar_gimnasio(s, gym.id)
        con_gimnasio = (await s.execute(text("SELECT count(*) FROM platform.ejercicios WHERE gimnasio_id IS NULL"))).scalar()
    async with fabrica.admin_engine.connect() as conn:
        total_global = (await conn.execute(text("SELECT count(*) FROM platform.ejercicios WHERE gimnasio_id IS NULL"))).scalar()
    assert con_gimnasio == total_global


async def test_funciones_de_resolucion(fabrica):
    gym = await fabrica.crear_gimnasio()
    async with async_session_maker() as s:
        encontrado = (await s.execute(text("SELECT platform.gimnasio_id_por_subdominio(:s)"), {"s": gym.subdominio.upper()})).scalar()
        inexistente = (await s.execute(text("SELECT platform.gimnasio_id_por_subdominio('no-existe-xyz')"))).scalar()
    assert encontrado == gym.id
    assert inexistente is None


async def test_rutas_sin_sesion_siguen_funcionando(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    r_login = await login(cliente, gym, st)
    assert r_login.status_code == 200, r_login.text

    r_refresh = await cliente.post("/api/v1/auth/refresh", json={"refresh_token": r_login.json()["refresh_token"]})
    assert r_refresh.status_code == 200, r_refresh.text

    r_branding = await cliente.get(f"/api/v1/my-gym/public-branding/{gym.subdominio}")
    assert r_branding.status_code == 200, r_branding.text

    r_display = await cliente.get(f"/api/v1/pantalla-tv/display/{gym.subdominio}")
    assert r_display.status_code == 200, r_display.text

    r_no_existe = await cliente.get("/api/v1/my-gym/public-branding/no-existe-xyz")
    assert r_no_existe.status_code == 404


async def test_bloqueo_por_ip_cuenta_fallos_de_todos_los_gimnasios(fabrica):
    """15 fallos desde una IP, repartidos entre gimnasios, la bloquean (antes de saber el gimnasio)."""
    gym_a = await fabrica.crear_gimnasio()
    gym_b = await fabrica.crear_gimnasio()
    st_a = await fabrica.crear_staff(gym_a)
    st_b = await fabrica.crear_staff(gym_b)

    # IP de documentación (RFC 3849) única por corrida: no bloquea a las demás pruebas ni a la
    # siguiente corrida. Los intentos no se borran en cascada con el gimnasio: se limpian aquí.
    ip = f"2001:db8::{uuid4().hex[:4]}:{uuid4().hex[:4]}"
    transporte = ASGITransport(app=app, client=(ip, 5555))
    try:
        async with AsyncClient(transport=transporte, base_url="http://test") as c:
            for i in range(15):
                gym, st = (gym_a, st_a) if i % 2 == 0 else (gym_b, st_b)
                r = await login(c, gym, {**st, "correo": f"nadie{i}-{st['correo']}"}, password="mala")
                assert r.status_code == 401, r.text
            r_bloqueado = await login(c, gym_a, st_a)
        assert r_bloqueado.status_code == 429
        assert r_bloqueado.json()["error"]["codigo"] == "IP_BLOQUEADA_TEMPORALMENTE"
    finally:
        async with fabrica.admin_engine.begin() as conn:
            await conn.execute(text("DELETE FROM platform.intentos_login_staff WHERE ip = CAST(:ip AS inet)"), {"ip": ip})
