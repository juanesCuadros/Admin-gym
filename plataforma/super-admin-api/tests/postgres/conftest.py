"""Pruebas contra PostgreSQL real (base del carril 3: gymos_c3).

Cada prueba corre en una transacción que se revierte al final. La conexión es de superusuario
(TEST_POSTGRES_URL) pero la app trabaja con `SET LOCAL ROLE gymos_superadmin`, así que los
permisos que se prueban son los reales del Super-Admin. Para sembrar datos del tenant (que el SA
no puede escribir) se usa `como_superusuario(sesion)`.
"""
import uuid
from typing import Optional

import psycopg2.extensions as _ext
import pytest
from fastapi.testclient import TestClient
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

from app.main import app
from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.security import create_access_token, get_password_hash


class _ConfigPruebas(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    TEST_POSTGRES_URL: Optional[str] = None


_URL = _ConfigPruebas().TEST_POSTGRES_URL

_UUID_STR = _ext.new_type((2950,), "UUID_STR_PRUEBAS", lambda v, c: v)


@pytest.fixture(scope="session")
def pg_engine():
    if not _URL:
        pytest.skip("TEST_POSTGRES_URL no está configurada en .env")
    engine = create_engine(_URL, pool_pre_ping=True)

    @event.listens_for(engine, "connect")
    def _uuid_como_texto(dbapi_conn, rec):
        _ext.register_type(_UUID_STR, dbapi_conn)

    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - entorno sin BD
        pytest.skip(f"PostgreSQL de pruebas no disponible: {exc}")
    yield engine
    engine.dispose()


@pytest.fixture
def pg_session(pg_engine):
    connection = pg_engine.connect()
    transaction = connection.begin()
    connection.execute(text("SET LOCAL ROLE gymos_superadmin"))
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def pg_client(pg_session):
    def _override():
        yield pg_session

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def pg_admin(pg_session) -> UsuarioInterno:
    admin = UsuarioInterno(
        nombre="Operador MVC de pruebas",
        correo=f"mvc-{uuid.uuid4().hex[:8]}@pruebas.gymos.co",
        hash_password=get_password_hash("ClaveSegura2026!"),
        rol="admin",
        activo=True,
    )
    pg_session.add(admin)
    pg_session.commit()
    return admin


@pytest.fixture
def pg_headers(pg_admin) -> dict:
    token = create_access_token(subject=pg_admin.id, email=pg_admin.correo, role=pg_admin.rol)
    return {"Authorization": f"Bearer {token}"}
