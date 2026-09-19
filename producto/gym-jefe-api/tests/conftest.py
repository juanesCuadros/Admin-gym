"""
Fixtures compartidas para pruebas contra PostgreSQL real (GW-RNF-11: sin mocks).

Requiere la BD del compose dev (`infra/docker-compose.dev.yml`) y un `.env` en
`gym-jefe-api/` con `DATABASE_URL` apuntando a ella (rol gymos_platform).
Para preparar datos del esquema `superadmin` (suscripción, credenciales del Jefe)
se usa una conexión de superusuario: `TEST_ADMIN_DATABASE_URL`
(por defecto postgres:postgres@localhost:5433/gymos_db).
"""
import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import AsyncIterator, Optional
from uuid import UUID, uuid4

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.database import async_session_maker
from app.core.security import hash_password
from app.main import app

ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DATABASE_URL",
    "postgresql+asyncpg://postgres:postgres@localhost:5433/gymos_db",
)


@dataclass
class Gimnasio:
    id: UUID
    subdominio: str
    nombre: str
    superadmin_id: Optional[UUID] = None
    staff: list = field(default_factory=list)


class Fabrica:
    """Crea gimnasios y staff de prueba y los borra al terminar."""

    def __init__(self):
        self.admin_engine = create_async_engine(ADMIN_URL, echo=False, pool_size=2)
        self.gimnasios: list[Gimnasio] = []

    async def crear_gimnasio(
        self,
        *,
        estado: str = "activo",
        fecha_corte: Optional[date] = None,
        activo: bool = True,
        con_superadmin: bool = True,
        duracion_sesion_minutos: int = 60,
    ) -> Gimnasio:
        gym_id = uuid4()
        sub = f"t15-{uuid4().hex[:8]}"
        nombre = f"Gym T15 {sub}"

        async with async_session_maker() as s:
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym_id)})
            await s.execute(
                text("""
                    INSERT INTO platform.tenant (id, nombre, subdominio, activo, duracion_sesion_minutos, branding)
                    VALUES (:id, :nombre, :sub, :activo, :dur, '{"primary_color": "#123456"}'::jsonb)
                """),
                {"id": gym_id, "nombre": nombre, "sub": sub, "activo": activo, "dur": duracion_sesion_minutos},
            )
            await s.commit()

        g = Gimnasio(id=gym_id, subdominio=sub, nombre=nombre)

        if con_superadmin:
            sa_id = uuid4()
            async with self.admin_engine.begin() as conn:
                await conn.execute(
                    text("""
                        INSERT INTO superadmin.gimnasios
                          (id, gimnasio_id, nombre, subdominio, estado, fecha_inicio, fecha_corte,
                           motivo_cancelacion, fecha_cancelacion)
                        VALUES (:id, :gid, :nombre, :sub, :estado, current_date - 30, :corte,
                           CASE WHEN :estado = 'cancelado' THEN 'prueba' END,
                           CASE WHEN :estado = 'cancelado' THEN now() END)
                    """),
                    {"id": sa_id, "gid": gym_id, "nombre": nombre, "sub": sub, "estado": estado, "corte": fecha_corte},
                )
            g.superadmin_id = sa_id

        self.gimnasios.append(g)
        return g

    async def crear_staff(
        self,
        gym: Gimnasio,
        *,
        rol: str = "recepcionista",
        password: str = "Clave-Segura-123",
        activo: bool = True,
        debe_cambiar_password: bool = False,
        password_temporal_expira_en: Optional[datetime] = None,
    ) -> dict:
        staff_id = uuid4()
        correo = f"{rol}-{uuid4().hex[:6]}@t15-gymos.com"
        async with async_session_maker() as s:
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
            await s.execute(
                text("""
                    INSERT INTO platform.staff
                      (id, gimnasio_id, nombre, correo, hash_password, rol, activo,
                       debe_cambiar_password, password_temporal_expira_en)
                    VALUES (:id, :g, :nombre, :correo, :h, :rol, :activo, :dcp, :exp)
                """),
                {
                    "id": staff_id, "g": gym.id, "nombre": f"Staff {rol}", "correo": correo,
                    "h": hash_password(password), "rol": rol, "activo": activo,
                    "dcp": debe_cambiar_password, "exp": password_temporal_expira_en,
                },
            )
            await s.commit()
        st = {"id": staff_id, "correo": correo, "password": password, "rol": rol}
        gym.staff.append(st)
        return st

    async def crear_cuenta_jefe_superadmin(
        self, gym: Gimnasio, correo: str, *, password_cambiada: bool, emision_expira_en: Optional[datetime]
    ) -> None:
        """Simula lo que deja el provisioning del Super-Admin para el Jefe."""
        async with self.admin_engine.begin() as conn:
            await conn.execute(
                text("""
                    INSERT INTO superadmin.cuentas_jefe (gimnasio_id, nombre, correo, password_cambiada)
                    VALUES (:g, 'Jefe T15', :correo, :pc)
                """),
                {"g": gym.superadmin_id, "correo": correo, "pc": password_cambiada},
            )
            if emision_expira_en is not None:
                await conn.execute(
                    text("""
                        INSERT INTO superadmin.emisiones_credenciales (gimnasio_id, tipo, expira_en)
                        VALUES (:g, 'emitida', :exp)
                    """),
                    {"g": gym.superadmin_id, "exp": emision_expira_en},
                )

    async def limpiar(self) -> None:
        async with self.admin_engine.begin() as conn:
            # auditoria_gym es append-only por trigger; la limpieza de datos de prueba
            # la hace el superusuario con los triggers apagados solo en esta sesión.
            await conn.execute(text("SET LOCAL session_replication_role = replica"))
            for g in self.gimnasios:
                if g.superadmin_id:
                    await conn.execute(text("DELETE FROM superadmin.gimnasios WHERE id = :id"), {"id": g.superadmin_id})
                # platform: el tenant borra en cascada staff, sesiones, tokens, auditoría, intentos
                await conn.execute(text("DELETE FROM platform.tenant WHERE id = :id"), {"id": g.id})
        await self.admin_engine.dispose()


@pytest_asyncio.fixture
async def fabrica() -> AsyncIterator[Fabrica]:
    f = Fabrica()
    try:
        yield f
    finally:
        await f.limpiar()


@pytest_asyncio.fixture
async def cliente() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def login(cliente: AsyncClient, gym: Gimnasio, staff: dict, password: Optional[str] = None):
    return await cliente.post(
        "/api/v1/auth/login",
        json={"subdominio": gym.subdominio, "correo": staff["correo"], "password": password or staff["password"]},
    )


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


def en_horas(h: float) -> datetime:
    return ahora_utc() + timedelta(hours=h)
