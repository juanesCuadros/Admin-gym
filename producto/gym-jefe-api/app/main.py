from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1.router import api_v1_router
from app.core.config import settings
from app.core.database import engine
from app.core.exceptions import register_exception_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verificación de conexión a la base de datos
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        print(" Conexión inicial a PostgreSQL establecida correctamente.")
    except Exception as e:
        print(f" Advertencia: No se pudo conectar a PostgreSQL al iniciar: {e}")

    # Suscripción de eventos desacoplada (Módulo 1 -> Módulo 2)
    from app.modules.control_ingreso.service import ControlIngresoService
    from app.modules.pantalla_tv.manager import PantallaTvConnectionManager
    ControlIngresoService.registrar_listener(PantallaTvConnectionManager.on_checkin_event)

    yield
    # Shutdown: cerrar conexiones activas del pool
    await engine.dispose()
    print(" Pool de conexiones de base de datos cerrado correctamente.")


es_produccion = settings.ENVIRONMENT.lower() == "production"

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="API Backend del Sistema Web del Gimnasio (GymOS) - Multi-tenant con RLS",
    lifespan=lifespan,
    docs_url=None if es_produccion else "/docs",
    redoc_url=None if es_produccion else "/redoc",
    openapi_url=None if es_produccion else "/openapi.json"
)

# Configuración de CORS (admite orígenes explícitos y subdominios dinámicos *.localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"https?://.*\.localhost(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registro de manejadores de excepciones estándar
register_exception_handlers(app)

# Inclusión del Router Central v1
app.include_router(api_v1_router)


@app.get("/health", tags=["Health"], summary="Comprobación de salud de la API")
async def health_check():
    """
    Endpoint de comprobación de salud y conectividad del servicio API.
    Verifica activamente la conectividad con la base de datos en cada petición.
    Responde 503 si la base de datos falla.
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "database": "unhealthy",
                "app": settings.PROJECT_NAME,
                "version": settings.VERSION,
                "environment": settings.ENVIRONMENT,
            },
        )

    return {
        "status": "healthy",
        "database": db_status,
        "app": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }


@app.get("/", tags=["Root"], summary="Página de bienvenida de la API")
async def root():
    """
    Punto de entrada raíz de la API con enlaces a la documentación Swagger y ReDoc fuera de producción.
    """
    resp = {
        "message": f"Bienvenido a {settings.PROJECT_NAME}",
        "version": settings.VERSION,
    }
    if not es_produccion:
        resp["docs"] = "/docs"
    return resp
