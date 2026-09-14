import logging
from typing import AsyncGenerator, Awaitable, Callable, List
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from app.core.config import settings

logger = logging.getLogger(__name__)

# Motor asíncrono para PostgreSQL usando asyncpg
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True
)

# Creador de sesiones asíncronas
async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()

CommitHook = Callable[[], Awaitable[None]]


def on_commit(session: AsyncSession, hook: CommitHook) -> None:
    """
    Registra un callback asíncrono que se ejecutará ÚNICAMENTE tras confirmarse exitosamente
    el commit de la transacción actual en get_db_session.
    Si la transacción falla o hace rollback, los hooks registrados se descartan automáticamente.
    Estándar arquitectural para eventos en tiempo real (WebSockets, notificaciones externas).
    """
    if "_post_commit_hooks" not in session.info:
        session.info["_post_commit_hooks"] = []
    session.info["_post_commit_hooks"].append(hook)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Generador de sesión asíncrona de base de datos con commit/rollback centralizado por request."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        else:
            # Ejecución protegida de callbacks pos-commit
            hooks: List[CommitHook] = session.info.get("_post_commit_hooks", [])
            for hook in hooks:
                try:
                    await hook()
                except Exception as e:
                    logger.error(f"Error ejecutando post_commit_hook: {e}", exc_info=True)
