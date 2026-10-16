from typing import List, Optional
import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, AnyHttpUrl

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # API
    PROJECT_NAME: str = "GymOS Super-Admin Backend"
    API_V1_STR: str = "/api/v1"
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000

    # Security
    JWT_SECRET_KEY: str = "superadmin_dev_secret_key_change_in_production_2026_xyz"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Brute Force Protection (RF-00.4)
    MAX_LOGIN_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15
    # Recuperación de contraseña (SA-RF-00.2 CA2): 1 hora
    RECOVERY_TOKEN_MINUTES: int = 60

    # Database: Default to sqlite in-memory for testing, or PostgreSQL with RLS
    DATABASE_URL: str = Field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL",
            "postgresql+psycopg2://gymos_superadmin:gymos_superadmin_secret@localhost:5432/gymos_db"
        )
    )

    # Version
    VERSION: str = "1.0.0"

    # Initial Super Admin Seed (Lifespan)
    FIRST_SUPERADMIN_EMAIL: str = "admin@gymos.internal"
    FIRST_SUPERADMIN_PASSWORD: str = "SuperAdmin2026!Seguro"

    # Domain defaults
    BASE_DOMAIN: str = "gymos.io"
    # Dirección de cada gimnasio. En local: "http://{subdominio}.localhost:3000".
    URL_GIMNASIO: str = "https://{subdominio}.{dominio}"
    DEFAULT_TRIAL_DAYS: int = 5
    CREDENTIALS_EXPIRE_HOURS: int = 72

    # Registro autónomo (SA-RF-34)
    SIGNUP_TOKEN_HORAS: int = 24
    # Página pública (gymdeskcolombia.com) que recibe el token y llama a /public/signup/{token}
    URL_CONFIRMACION_REGISTRO: str = "https://gymdeskcolombia.com/registro/confirmar"

    # Correo saliente: "log" (desarrollo: solo registra en el log) o "resend" (API de Resend)
    CORREO_MODO: str = "log"
    CORREO_REMITENTE: str = "GymOS <no-responder@gymdeskcolombia.com>"
    RESEND_API_KEY: Optional[str] = None

    # Exportación al cancelar (SA-RF-30): carpeta del servidor propio y URL pública de la API
    EXPORTS_DIR: str = "./data/exports"
    PUBLIC_API_BASE_URL: str = "http://localhost:8000"

    # CORS (Without wildcard '*' to allow secure credentials)
    CORS_ORIGINS: List[str] = [
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:5173"
    ]
    BACKEND_CORS_ORIGINS: List[str] = CORS_ORIGINS

    def url_gimnasio(self, subdominio: str) -> str:
        """Dirección pública del sistema de un gimnasio (sin ruta)."""
        return self.URL_GIMNASIO.format(subdominio=subdominio, dominio=self.BASE_DOMAIN)


settings = Settings()
