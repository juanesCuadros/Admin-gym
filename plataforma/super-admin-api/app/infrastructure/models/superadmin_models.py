import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from typing import Optional, List
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, BigInteger,
    Numeric, Date, DateTime, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.infrastructure.database.base import Base
from app.core.config import settings

def _schema():
    return None if "sqlite" in settings.DATABASE_URL else "superadmin"

class UsuarioInterno(Base):
    __tablename__ = "usuarios_internos"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    nombre = Column(String(255), nullable=False)
    correo = Column(String(255), nullable=False, unique=True, index=True)
    hash_password = Column(String(255), nullable=False)
    rol = Column(String(50), nullable=False, default="admin")
    activo = Column(Boolean, nullable=False, default=True)
    mfa_secret = Column(String(255), nullable=True)
    ultimo_ingreso = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class IntentoLogin(Base):
    __tablename__ = "intentos_login"
    __table_args__ = (
        Index("ix_intentos_correo_ts", "correo", "created_at"),
        {"schema": _schema()}
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    correo = Column(String(255), nullable=False, index=True)
    ip = Column(String(45), nullable=True)
    exito = Column(Boolean, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class TokenRecuperacion(Base):
    __tablename__ = "tokens_recuperacion"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    usuario_id = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}usuarios_internos.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True)
    expira_en = Column(DateTime(timezone=True), nullable=False)
    usado_en = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class TokenInvalido(Base):
    """
    Stores revoked JWT tokens upon logout (RF-00.3).
    Ensures that once a Super-Admin operator logs out, the token cannot be reused even before exp.
    """
    __tablename__ = "tokens_invalidos"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    usuario_id = Column(String(36), nullable=True)
    expira_en = Column(DateTime(timezone=True), nullable=False)
    revocado_en = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class Gimnasio(Base):
    __tablename__ = "gimnasios"
    __table_args__ = (
        Index("ix_gym_estado", "estado"),
        Index("ix_gym_fecha_corte", "fecha_corte"),
        {"schema": _schema()}
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), nullable=False, unique=True, default=lambda: str(uuid.uuid4()))
    nombre = Column(String(255), nullable=False, index=True)
    subdominio = Column(String(63), nullable=False, unique=True, index=True)
    nit = Column(String(50), nullable=True)
    direccion = Column(String(255), nullable=True)
    ciudad = Column(String(100), nullable=True)
    telefono = Column(String(50), nullable=True)
    correo = Column(String(255), nullable=True)
    estado = Column(String(50), nullable=False, default="prueba")  # prueba, activo, suspendido, cancelado
    fecha_inicio = Column(Date, nullable=False, default=date.today)
    fecha_corte = Column(Date, nullable=True)
    logo_url = Column(Text, nullable=True)
    banner_url = Column(Text, nullable=True)
    descripcion = Column(String(300), nullable=True)
    instagram = Column(String(100), nullable=True)
    facebook = Column(String(100), nullable=True)
    whatsapp = Column(String(50), nullable=True)
    motivo_cancelacion = Column(Text, nullable=True)
    fecha_cancelacion = Column(DateTime(timezone=True), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    cuenta_jefe = relationship("CuentaJefe", back_populates="gimnasio", uselist=False, cascade="all, delete-orphan")
    suscripciones = relationship("Suscripcion", back_populates="gimnasio", cascade="all, delete-orphan", order_by="desc(Suscripcion.vigente_desde)")
    pagos = relationship("Pago", back_populates="gimnasio", cascade="all, delete-orphan", order_by="desc(Pago.fecha_pago)")
    credenciales = relationship("EmisionCredenciales", back_populates="gimnasio", cascade="all, delete-orphan")
    provisioning_pasos = relationship("ProvisioningPaso", back_populates="gimnasio", cascade="all, delete-orphan")

class CuentaJefe(Base):
    __tablename__ = "cuentas_jefe"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}gimnasios.id", ondelete="CASCADE"), nullable=False, unique=True)
    nombre = Column(String(255), nullable=False)
    correo = Column(String(255), nullable=False, unique=True, index=True)
    telefono = Column(String(50), nullable=True)
    password_cambiada = Column(Boolean, nullable=False, default=False)
    ultimo_ingreso = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    gimnasio = relationship("Gimnasio", back_populates="cuenta_jefe")

class Suscripcion(Base):
    __tablename__ = "suscripciones"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}gimnasios.id", ondelete="CASCADE"), nullable=False, index=True)
    valor_mensual = Column(Numeric(12, 2), nullable=False)
    tipo_inicio = Column(String(50), nullable=False)  # 'prueba', 'cliente_activo'
    vigente_desde = Column(Date, nullable=False)
    vigente_hasta = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    gimnasio = relationship("Gimnasio", back_populates="suscripciones")

class Pago(Base):
    __tablename__ = "pagos"
    __table_args__ = (
        Index("ix_pagos_gym_fecha", "gimnasio_id", "fecha_pago"),
        {"schema": _schema()}
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}gimnasios.id", ondelete="RESTRICT"), nullable=False, index=True)
    monto = Column(Numeric(12, 2), nullable=False)
    meses = Column(Integer, nullable=False)
    fecha_pago = Column(Date, nullable=False, default=date.today)
    metodo = Column(String(100), nullable=False)
    nota = Column(Text, nullable=True)
    anulado = Column(Boolean, nullable=False, default=False, index=True)
    motivo_anulacion = Column(Text, nullable=True)
    anulado_por = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}usuarios_internos.id", ondelete="SET NULL"), nullable=True)
    anulado_en = Column(DateTime(timezone=True), nullable=True)
    idempotency_key = Column(String(100), nullable=False, unique=True)
    registrado_por = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}usuarios_internos.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    gimnasio = relationship("Gimnasio", back_populates="pagos")

class EmisionCredenciales(Base):
    __tablename__ = "emisiones_credenciales"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}gimnasios.id", ondelete="CASCADE"), nullable=False, index=True)
    tipo = Column(String(50), nullable=False)  # 'emitida', 'reenviada', 'regenerada'
    expira_en = Column(DateTime(timezone=True), nullable=False)
    veces_reenviada = Column(Integer, nullable=False, default=0)
    enviada_por = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}usuarios_internos.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    gimnasio = relationship("Gimnasio", back_populates="credenciales")

class ProvisioningPaso(Base):
    __tablename__ = "provisioning_pasos"
    __table_args__ = (
        UniqueConstraint("gimnasio_id", "paso", name="uq_provisioning_gym_paso"),
        {"schema": _schema()}
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    gimnasio_id = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}gimnasios.id", ondelete="CASCADE"), nullable=False)
    paso = Column(String(100), nullable=False)
    estado = Column(String(50), nullable=False, default="pendiente")  # pendiente, en_proceso, completado, fallido
    intentos = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    gimnasio = relationship("Gimnasio", back_populates="provisioning_pasos")

class ClaveIdempotencia(Base):
    __tablename__ = "claves_idempotencia"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    clave = Column(String(255), nullable=False, unique=True, index=True)
    endpoint = Column(String(255), nullable=False)
    respuesta = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    expira_en = Column(DateTime(timezone=True), nullable=False)

class ImportacionesEjercicios(Base):
    __tablename__ = "importaciones_ejercicios"
    __table_args__ = {"schema": _schema()}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    dataset = Column(String(255), nullable=False)
    total = Column(Integer, nullable=False, default=0)
    actualizados = Column(Integer, nullable=False, default=0)
    ignorados = Column(Integer, nullable=False, default=0)
    omitidos = Column(Integer, nullable=False, default=0)
    ejecutada_por = Column(String(36), ForeignKey(f"{_schema() + '.' if _schema() else ''}usuarios_internos.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

class Auditoria(Base):
    __tablename__ = "auditoria"
    __table_args__ = (
        Index("ix_aud_gym", "gimnasio_id", "created_at"),
        Index("ix_aud_actor", "actor_id", "created_at"),
        Index("ix_aud_accion", "accion", "created_at"),
        {"schema": _schema()}
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    gimnasio_id = Column(String(36), nullable=True)
    actor_id = Column(String(36), nullable=True)
    actor_nombre = Column(String(255), nullable=False)
    impersonando = Column(Boolean, nullable=False, default=False)
    accion = Column(String(100), nullable=False)
    entidad = Column(String(100), nullable=False)
    entidad_id = Column(String(100), nullable=True)
    detalle = Column(Text, nullable=True)  # JSON string
    hash_previo = Column(String(64), nullable=True)
    hash_actual = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
