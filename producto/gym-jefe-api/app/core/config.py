from typing import List, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    PROJECT_NAME: str = "GymOS - Sistema Web del Gimnasio"
    VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Base de Datos
    DATABASE_URL: str = "postgresql+asyncpg://gymos_platform:cambiar_password@localhost:5432/gymos"

    # JWT
    JWT_SECRET_KEY: str = "cambiar_esta_clave_secreta_jwt_por_cadena_segura_de_32_caracteres"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Zona Horaria Operativa
    TIMEZONE: str = "America/Bogota"

    # Cifrado Biométrico de Huellas (RNF-01) - Obligatorio sin default
    BIOMETRIC_ENCRYPTION_KEY: str

    @field_validator("BIOMETRIC_ENCRYPTION_KEY")
    @classmethod
    def validate_biometric_encryption_key(cls, v: str) -> str:
        key_str = v.strip()
        try:
            key_bytes = bytes.fromhex(key_str)
        except ValueError:
            raise ValueError("BIOMETRIC_ENCRYPTION_KEY debe ser una cadena hexadecimal válida.")
        if len(key_bytes) != 32:
            raise ValueError(
                f"BIOMETRIC_ENCRYPTION_KEY debe tener exactamente 32 bytes (64 caracteres hexadecimales). Longitud recibida: {len(key_bytes)} bytes."
            )
        return key_str

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173", "app://electron"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, list):
            return v
        import json
        return json.loads(v)


settings = Settings()
