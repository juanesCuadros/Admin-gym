import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.security import get_password_hash, create_access_token
from app.core.config import settings

# Test in-memory SQLite database
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

@event.listens_for(engine, "connect")
def do_connect(dbapi_connection, connection_record):
    """Attach separate schemas in SQLite so superadmin and platform schemas work seamlessly."""
    cursor = dbapi_connection.cursor()
    cursor.execute("ATTACH DATABASE ':memory:' AS superadmin")
    cursor.execute("ATTACH DATABASE ':memory:' AS platform")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
import app.main as main_module
main_module.SessionLocal = TestingSessionLocal


@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Create all schema tables in test database once per test session."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session():
    """Provides a transactional database session rolled back after each test."""
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(db_session):
    """FastAPI TestClient with overridden database dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

@pytest.fixture
def test_superadmin(db_session) -> UsuarioInterno:
    """Seeds an authenticated Super Admin user for testing."""
    admin = UsuarioInterno(
        nombre="Test Superadmin",
        correo="superadmin@test.gymos.io",
        hash_password=get_password_hash("SuperSecret123!"),
        rol="superadmin",
        activo=True
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin

@pytest.fixture
def superadmin_auth_headers(test_superadmin) -> dict:
    """Generates Bearer token headers for authenticated endpoints."""
    token = create_access_token(
        subject=test_superadmin.id,
        email=test_superadmin.correo,
        role=test_superadmin.rol
    )
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def expired_auth_headers(test_superadmin) -> dict:
    """Generates an expired Bearer token for security testing."""
    from datetime import timedelta
    token = create_access_token(
        subject=test_superadmin.id,
        email=test_superadmin.correo,
        role=test_superadmin.rol,
        expires_delta=timedelta(seconds=-60)
    )
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def tenant_staff_auth_headers() -> dict:
    """Generates a token with a tenant staff role ('jefe') to test unauthorized superadmin access."""
    import uuid
    token = create_access_token(
        subject=str(uuid.uuid4()),
        email="jefe@tenant-gym.com",
        role="jefe"
    )
    return {"Authorization": f"Bearer {token}"}

