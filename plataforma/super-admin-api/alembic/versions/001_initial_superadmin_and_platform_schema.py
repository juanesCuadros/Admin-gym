"""Initial superadmin and platform schemas

Revision ID: 001_initial_superadmin_platform
Revises: 
Create Date: 2026-09-08 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '001_initial_superadmin_platform'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Extensions and schemas
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
    op.execute('CREATE EXTENSION IF NOT EXISTS "citext";')
    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_trgm";')
    op.execute('CREATE SCHEMA IF NOT EXISTS superadmin;')
    op.execute('CREATE SCHEMA IF NOT EXISTS platform;')

    # superadmin.usuarios_internos
    op.create_table(
        'usuarios_internos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('nombre', sa.Text(), nullable=False),
        sa.Column('correo', sa.dialects.postgresql.CITEXT(), nullable=False, unique=True),
        sa.Column('hash_password', sa.Text(), nullable=False),
        sa.Column('rol', sa.Text(), nullable=False, server_default='admin'),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('mfa_secret', sa.Text(), nullable=True),
        sa.Column('ultimo_ingreso', sa.DateTime(timezone=True), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.intentos_login
    op.create_table(
        'intentos_login',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('correo', sa.dialects.postgresql.CITEXT(), nullable=False),
        sa.Column('ip', postgresql.INET(), nullable=True),
        sa.Column('exito', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.gimnasios
    op.create_table(
        'gimnasios',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), nullable=False, unique=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('nombre', sa.Text(), nullable=False),
        sa.Column('subdominio', sa.Text(), nullable=False, unique=True),
        sa.Column('nit', sa.Text(), nullable=True),
        sa.Column('direccion', sa.Text(), nullable=True),
        sa.Column('ciudad', sa.Text(), nullable=True),
        sa.Column('telefono', sa.Text(), nullable=True),
        sa.Column('correo', sa.dialects.postgresql.CITEXT(), nullable=True),
        sa.Column('estado', sa.Text(), nullable=False, server_default='prueba'),
        sa.Column('fecha_inicio', sa.Date(), nullable=False, server_default=sa.text('current_date')),
        sa.Column('fecha_corte', sa.Date(), nullable=True),
        sa.Column('logo_url', sa.Text(), nullable=True),
        sa.Column('banner_url', sa.Text(), nullable=True),
        sa.Column('descripcion', sa.Text(), nullable=True),
        sa.Column('instagram', sa.Text(), nullable=True),
        sa.Column('facebook', sa.Text(), nullable=True),
        sa.Column('whatsapp', sa.Text(), nullable=True),
        sa.Column('motivo_cancelacion', sa.Text(), nullable=True),
        sa.Column('fecha_cancelacion', sa.DateTime(timezone=True), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.cuentas_jefe
    op.create_table(
        'cuentas_jefe',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.gimnasios.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('nombre', sa.Text(), nullable=False),
        sa.Column('correo', sa.dialects.postgresql.CITEXT(), nullable=False, unique=True),
        sa.Column('telefono', sa.Text(), nullable=True),
        sa.Column('password_cambiada', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('ultimo_ingreso', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.suscripciones
    op.create_table(
        'suscripciones',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.gimnasios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('valor_mensual', sa.Numeric(12, 2), nullable=False),
        sa.Column('tipo_inicio', sa.Text(), nullable=False),
        sa.Column('vigente_desde', sa.Date(), nullable=False),
        sa.Column('vigente_hasta', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.pagos
    op.create_table(
        'pagos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.gimnasios.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('monto', sa.Numeric(12, 2), nullable=False),
        sa.Column('meses', sa.Integer(), nullable=False),
        sa.Column('fecha_pago', sa.Date(), nullable=False, server_default=sa.text('current_date')),
        sa.Column('metodo', sa.Text(), nullable=False),
        sa.Column('nota', sa.Text(), nullable=True),
        sa.Column('anulado', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('motivo_anulacion', sa.Text(), nullable=True),
        sa.Column('anulado_por', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.usuarios_internos.id', ondelete='SET NULL'), nullable=True),
        sa.Column('anulado_en', sa.DateTime(timezone=True), nullable=True),
        sa.Column('idempotency_key', sa.Text(), nullable=False, unique=True),
        sa.Column('registrado_por', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.usuarios_internos.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.emisiones_credenciales
    op.create_table(
        'emisiones_credenciales',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.gimnasios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tipo', sa.Text(), nullable=False),
        sa.Column('expira_en', sa.DateTime(timezone=True), nullable=False),
        sa.Column('veces_reenviada', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('enviada_por', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.usuarios_internos.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # superadmin.provisioning_pasos
    op.create_table(
        'provisioning_pasos',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('superadmin.gimnasios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('paso', sa.Text(), nullable=False),
        sa.Column('estado', sa.Text(), nullable=False, server_default='pendiente'),
        sa.Column('intentos', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('gimnasio_id', 'paso', name='uq_provisioning_gym_paso'),
        schema='superadmin'
    )

    # superadmin.auditoria (append-only hash chain)
    op.create_table(
        'auditoria',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('actor_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('actor_nombre', sa.Text(), nullable=False),
        sa.Column('impersonando', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('accion', sa.Text(), nullable=False),
        sa.Column('entidad', sa.Text(), nullable=False),
        sa.Column('entidad_id', sa.Text(), nullable=True),
        sa.Column('detalle', postgresql.JSONB(), nullable=True),
        sa.Column('hash_previo', sa.Text(), nullable=True),
        sa.Column('hash_actual', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='superadmin'
    )

    # platform.tenant
    op.create_table(
        'tenant',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('nombre', sa.Text(), nullable=False),
        sa.Column('subdominio', sa.Text(), nullable=False, unique=True),
        sa.Column('zona_horaria', sa.Text(), nullable=False, server_default='America/Bogota'),
        sa.Column('dias_gracia_mora', sa.Integer(), nullable=False, server_default=sa.text('3')),
        sa.Column('tope_dias_congelamiento', sa.Integer(), nullable=False, server_default=sa.text('30')),
        sa.Column('metodos_pago', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('horarios', postgresql.JSONB(), nullable=True),
        sa.Column('landing_slug', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='platform'
    )

    # platform.staff
    op.create_table(
        'staff',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('platform.tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('nombre', sa.Text(), nullable=False),
        sa.Column('correo', sa.dialects.postgresql.CITEXT(), nullable=False),
        sa.Column('hash_password', sa.Text(), nullable=False),
        sa.Column('rol', sa.Text(), nullable=False),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('ultimo_ingreso', sa.DateTime(timezone=True), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('gimnasio_id', 'correo', name='uq_staff_gym_correo'),
        schema='platform'
    )

    # platform.ejercicios
    op.create_table(
        'ejercicios',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('gimnasio_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('platform.tenant.id', ondelete='CASCADE'), nullable=True),
        sa.Column('propio', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('nombre_es', sa.Text(), nullable=False),
        sa.Column('nombre_en', sa.Text(), nullable=True),
        sa.Column('instrucciones', sa.Text(), nullable=True),
        sa.Column('grupo_muscular', sa.Text(), nullable=True),
        sa.Column('equipo', sa.Text(), nullable=True),
        sa.Column('categoria', sa.Text(), nullable=True),
        sa.Column('archivo_url', sa.Text(), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        schema='platform'
    )

def downgrade() -> None:
    op.drop_table('ejercicios', schema='platform')
    op.drop_table('staff', schema='platform')
    op.drop_table('tenant', schema='platform')
    op.drop_table('auditoria', schema='superadmin')
    op.drop_table('provisioning_pasos', schema='superadmin')
    op.drop_table('emisiones_credenciales', schema='superadmin')
    op.drop_table('pagos', schema='superadmin')
    op.drop_table('suscripciones', schema='superadmin')
    op.drop_table('cuentas_jefe', schema='superadmin')
    op.drop_table('gimnasios', schema='superadmin')
    op.drop_table('intentos_login', schema='superadmin')
    op.drop_table('usuarios_internos', schema='superadmin')
