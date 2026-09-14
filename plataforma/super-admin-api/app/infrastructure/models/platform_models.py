import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, Boolean, Integer,
    DateTime, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import relationship
from app.infrastructure.database.base import Base
from app.core.config import settings

def _platform_schema():
    return None if "sqlite" in settings.DATABASE_URL else "platform"

class Tenant(Base):
    __tablename__ = "tenant"
    __table_args__ = {"schema": _platform_schema()}

    id = Column(String(36), primary_key=True)  # Equal to superadmin.gimnasios.gimnasio_id
    nombre = Column(String(255), nullable=False)
    subdominio = Column(String(63), nullable=False, unique=True, index=True)
    zona_horaria = Column(String(50), nullable=False, default="America/Bogota")
    dias_gracia_mora = Column(Integer, nullable=False, default=3)
    tope_dias_congelamiento = Column(Integer, nullable=False, default=30)
    metodos_pago = Column(Text, nullable=False, default="[]")  # JSON string
    horarios = Column(Text, nullable=True)  # JSON string
    landing_slug = Column(String(100), nullable=True)
    activo = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    staff = relationship("Staff", back_populates="tenant", cascade="all, delete-orphan")

class Staff(Base):
    __tablename__ = "staff"
    __table_args__ = (
        UniqueConstraint("gimnasio_id", "correo", name="uq_staff_gym_correo"),
        {"schema": _platform_schema()}
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), ForeignKey(f"{_platform_schema() + '.' if _platform_schema() else ''}tenant.id", ondelete="CASCADE"), nullable=False, index=True)
    nombre = Column(String(255), nullable=False)
    correo = Column(String(255), nullable=False)
    hash_password = Column(String(255), nullable=False)
    rol = Column(String(50), nullable=False)  # 'jefe', 'recepcionista', 'entrenador'
    activo = Column(Boolean, nullable=False, default=True)
    ultimo_ingreso = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    tenant = relationship("Tenant", back_populates="staff")

class Ejercicio(Base):
    __tablename__ = "ejercicios"
    __table_args__ = (
        Index("ix_ejer_global", "activo"),
        {"schema": _platform_schema()}
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), nullable=True, index=True)  # NULL = Global exercise
    propio = Column(Boolean, nullable=False, default=False)
    nombre_es = Column(String(255), nullable=False, index=True)
    nombre_en = Column(String(255), nullable=True)
    instrucciones = Column(Text, nullable=True)
    grupo_muscular = Column(String(100), nullable=True, index=True)
    equipo = Column(String(100), nullable=True)
    categoria = Column(String(100), nullable=True, index=True)
    archivo_url = Column(Text, nullable=True)
    activo = Column(Boolean, nullable=False, default=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
