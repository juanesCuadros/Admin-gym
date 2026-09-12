from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="API Backend del Sistema Web del Gimnasio (GymOS) - Multi-tenant con RLS",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
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
    Endpoint de comprobación de salud y conectividad básica del servicio API.
    """
    return {
        "status": "healthy",
        "app": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT
    }


@app.get("/", tags=["Root"], summary="Página de bienvenida de la API")
async def root():
    """
    Punto de entrada raíz de la API con enlaces a la documentación Swagger y ReDoc.
    """
    return {
        "message": f"Bienvenido a {settings.PROJECT_NAME}",
        "docs": "/docs",
        "version": settings.VERSION
    }
