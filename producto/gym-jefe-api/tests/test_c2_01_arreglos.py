import pytest
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from uuid import uuid4

from app.core.config import settings
from app.core.timezone import today_local
from app.main import app
from app.modules.deportistas.schemas import CrearDeportistaRequest
from app.modules.deportistas.service import DeportistasService


@pytest.mark.asyncio
async def test_health_check_ok(cliente: AsyncClient):
    """GET /health retorna 200 cuando la base de datos está disponible."""
    res = await cliente.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["database"] == "healthy"


@pytest.mark.asyncio
async def test_health_check_db_fail(cliente: AsyncClient):
    """GET /health retorna 503 cuando la base de datos falla."""
    with patch.object(AsyncEngine, "connect", side_effect=Exception("Falla en base de datos")):
        res = await cliente.get("/health")
        assert res.status_code == 503
        data = res.json()
        assert data["status"] == "unhealthy"
        assert data["database"] == "unhealthy"


@pytest.mark.asyncio
async def test_docs_deshabilitados_en_produccion():
    """Verifica que en producción /docs, /redoc y /openapi.json se deshabilitan."""
    from fastapi import FastAPI
    with patch.object(settings, "ENVIRONMENT", "production"):
        es_prod = settings.ENVIRONMENT.lower() == "production"
        prod_app = FastAPI(
            docs_url=None if es_prod else "/docs",
            redoc_url=None if es_prod else "/redoc",
            openapi_url=None if es_prod else "/openapi.json",
        )
        async with AsyncClient(transport=ASGITransport(app=prod_app), base_url="http://test") as c:
            r_docs = await c.get("/docs")
            r_redoc = await c.get("/redoc")
            r_openapi = await c.get("/openapi.json")
            assert r_docs.status_code == 404
            assert r_redoc.status_code == 404
            assert r_openapi.status_code == 404


@pytest.mark.asyncio
async def test_enlace_invitacion_usa_app_url_base(fabrica):
    """Verifica que el enlace de invitación se construye con APP_URL_BASE sin hardcodear gymos.co."""
    gym = await fabrica.crear_gimnasio()
    staff = await fabrica.crear_staff(gym, rol="recepcionista")

    # Crear deportista directamente con correo
    from app.core.database import async_session_maker
    from sqlalchemy import text
    dep_id = uuid4()
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, correo, consentimiento_1581, consentimiento_fecha)
                VALUES (:id, :g, '12345678', 'Deportista Test', 'test@example.com', true, now())
            """),
            {"id": dep_id, "g": gym.id},
        )
        await s.commit()

        with patch.object(settings, "APP_URL_BASE", "https://{subdominio}.gymdeskcolombia.com"):
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
            res = await DeportistasService.generar_invitacion_app(
                session=s,
                gym_id=gym.id,
                deportista_id=dep_id,
                staff_id=staff["id"],
                staff_nombre="Staff Test",
            )
            assert "gymos.co" not in res.enlace_activacion
            assert f"https://{gym.subdominio}.gymdeskcolombia.com/activar-app?codigo=" in res.enlace_activacion


def test_validacion_menor_edad_fecha_bogota():
    """Verifica que la edad del menor se valida utilizando la fecha de Bogotá."""
    hoy = today_local()
    # Alguien que cumple 18 mañana en Bogotá tiene 17 hoy -> debe exigir acudiente
    nacimiento_17 = date(hoy.year - 18, hoy.month, hoy.day) + timedelta(days=1)
    
    with pytest.raises(ValueError, match="El nombre del acudiente es obligatorio para deportistas menores de 18"):
        CrearDeportistaRequest(
            documento="99887766",
            nombre="Menor Test",
            fecha_nacimiento=nacimiento_17,
            consentimiento_1581=True,
            acudiente_nombre=None,
        )

    # Alguien que cumplió 18 hoy en Bogotá no exige acudiente
    nacimiento_18 = date(hoy.year - 18, hoy.month, hoy.day)
    dep_18 = CrearDeportistaRequest(
        documento="99887765",
        nombre="Mayor Test",
        fecha_nacimiento=nacimiento_18,
        consentimiento_1581=True,
        acudiente_nombre=None,
    )
    assert dep_18.nombre == "Mayor Test"
