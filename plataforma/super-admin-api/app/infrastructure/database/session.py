from typing import Generator
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import settings

# Engine configuration
connect_args = {}
if "sqlite" in settings.DATABASE_URL:
    connect_args["check_same_thread"] = False

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    echo=settings.DEBUG and settings.ENVIRONMENT == "development",
    connect_args=connect_args
)

# Los ids son uuid en Postgres pero String(36) en el ORM y str en Pydantic.
# Se registra un typecaster para que psycopg2 devuelva uuid como texto.
if "psycopg2" in settings.DATABASE_URL:
    import psycopg2.extensions as _ext
    from sqlalchemy import event as _event

    _UUID_STR = _ext.new_type((2950,), "UUID_STR", lambda v, c: v)

    @_event.listens_for(engine, "connect")
    def _uuid_as_str(dbapi_conn, rec):
        _ext.register_type(_UUID_STR, dbapi_conn)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields an active database session and closes it afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def set_tenant_rls_context(session: Session, gimnasio_id: str) -> None:
    """
    Sets the PostgreSQL Row-Level Security session context:
    SET LOCAL app.gimnasio_id = '<uuid>';
    This ensures all platform schema queries are securely restricted to the tenant.
    """
    if "postgresql" in settings.DATABASE_URL:
        session.execute(text("SET LOCAL app.gimnasio_id = :gym_id"), {"gym_id": gimnasio_id})
