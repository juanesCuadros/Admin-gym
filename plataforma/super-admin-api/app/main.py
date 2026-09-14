from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.exceptions import AppException
from app.infrastructure.database.session import get_db, SessionLocal
from app.presentation.api.v1.router import api_router
from app.presentation.middleware.error_handler import (
    app_exception_handler, validation_exception_handler
)
from app.presentation.middleware.tenant_context import TenantContextMiddleware
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.security import get_password_hash

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifecycle manager for application startup and shutdown tasks.
    Seeds the initial Super Admin user if database is empty.
    """
    db: Session = SessionLocal()
    try:
        # Check if default superadmin exists
        admin = db.query(UsuarioInterno).filter(
            UsuarioInterno.correo == settings.FIRST_SUPERADMIN_EMAIL
        ).first()

        if not admin:
            hashed_pwd = get_password_hash(settings.FIRST_SUPERADMIN_PASSWORD)
            new_admin = UsuarioInterno(
                nombre="Super Administrador Fundador",
                correo=settings.FIRST_SUPERADMIN_EMAIL,
                hash_password=hashed_pwd,
                rol="superadmin",
                activo=True
            )
            db.add(new_admin)
            db.commit()
            print(f"[GymOS] Super Admin inicial creado: {settings.FIRST_SUPERADMIN_EMAIL}")
    except Exception as e:
        print(f"[GymOS] Advertencia en inicialización: {e}")
    finally:
        db.close()

    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="""
# GymOS - Backend del Módulo de Super Administrador (Ola 1 - MVP)

Plataforma SaaS multi-tenant diseñada para la administración y supervisión de gimnasios,
con aprovisionamiento asistido, control financiero estricto, catálogo multimedia global
y auditoría inmutable mediante encadenamiento criptográfico de hashes (SHA-256).

### Principios de Arquitectura:
- **Clean Architecture & Hexagonal**: Dominio puro desacoplado de frameworks e infraestructura.
- **Aislamiento Multi-tenant Estricto**: Esquema `superadmin` aislado y esquema `platform` protegido con PostgreSQL Row-Level Security (RLS).
- **Idempotencia Financiera (RNF-04)**: Fecha de corte derivada dinámicamente del historial de pagos vigentes.
- **Seguridad y Cero Fugas**: Credenciales de Jefe emitidas con Argon2id, vigencia de 72 horas y nunca registradas en texto plano ni en logs de auditoría.
    """,
    openapi_tags=[
        {"name": "Autenticación", "description": "Gestión de sesiones JWT y recuperación de contraseñas para operadores internos."},
        {"name": "Dashboard / Inicio", "description": "Métricas globales, estados de gimnasios, vencimientos y MRR estimado."},
        {"name": "Gimnasios (Tenants)", "description": "Gestión del ciclo de vida, aprovisionamiento asistido, subdominios y cambios de estado."},
        {"name": "Credenciales", "description": "Generación, regeneración y reenvío seguro de accesos temporales para Dueños de gimnasio."},
        {"name": "Cobros y Suscripciones", "description": "Registro idempotente de pagos, historial de precios y derivación de fechas de corte."},
        {"name": "Catálogo Multimedia Global", "description": "Biblioteca centralizada de ejercicios, búsqueda, filtros e importación por datasets."},
        {"name": "Auditoría Inmutable", "description": "Registro criptográfico inalterable (hash-chain) y verificación de integridad."},
    ],
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan
)


# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Middlewares
app.add_middleware(TenantContextMiddleware)

# Exception Handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

# API Routers
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/health", tags=["Salud del Sistema"], summary="Verificar estado del servicio y base de datos")
@app.get(f"{settings.API_V1_STR}/health", include_in_schema=False)
def health_check(db: Session = Depends(get_db)):
    """Verifica la conectividad con PostgreSQL y la disponibilidad del servicio."""
    try:
        db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as exc:
        import logging
        logging.getLogger("uvicorn.error").error(f"[HealthCheck] Error de conexión a BD: {exc}")
        db_status = "unhealthy"

    return {
        "status": "online",
        "database": db_status,
        "version": settings.VERSION,
        "app": settings.PROJECT_NAME
    }

@app.get("/", tags=["Salud del Sistema"], summary="Información base de la API")
def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs_url": "/docs",
        "api_v1": settings.API_V1_STR
    }

@app.get("/swagger-ui/index.html", include_in_schema=False)
@app.get("/swagger-ui", include_in_schema=False)
@app.get("/swagger-ui.html", include_in_schema=False)
def swagger_ui_redirect():
    """Redirecciona rutas tradicionales de Swagger (Spring Boot / Java) al Swagger de FastAPI."""
    return RedirectResponse(url="/docs")

