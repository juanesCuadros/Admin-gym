-- =====================================================================
-- GymOS — Esquema PostgreSQL completo
-- Una instancia, dos esquemas: superadmin (panel MVC) y platform (gimnasios + app)
-- Multi-tenancy: shared schema con gimnasio_id + Row-Level Security
-- Zona horaria: todo timestamptz en UTC; conversión a America/Bogota en presentación
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- correos case-insensitive
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- búsqueda por nombre

CREATE SCHEMA IF NOT EXISTS superadmin;
CREATE SCHEMA IF NOT EXISTS platform;

-- Roles de base de datos (aislamiento por usuario)
-- NOTA: ajustar contraseñas fuera de este script (no versionar secretos).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gymos_superadmin') THEN
    CREATE ROLE gymos_superadmin LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gymos_platform') THEN
    CREATE ROLE gymos_platform LOGIN;
  END IF;
END$$;


-- =====================================================================
-- ESQUEMA superadmin — panel interno de MVC
-- =====================================================================

-- --- Usuarios internos (2-3 personas, se crean directo en BD) ---------
CREATE TABLE superadmin.usuarios_internos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text        NOT NULL,
  correo          citext      NOT NULL UNIQUE,
  hash_password   text        NOT NULL,
  rol             text        NOT NULL DEFAULT 'admin'
                              CHECK (rol IN ('admin','soporte')),
  activo          boolean     NOT NULL DEFAULT true,
  mfa_secret      text,
  ultimo_ingreso  timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE superadmin.tokens_recuperacion (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   uuid        NOT NULL REFERENCES superadmin.usuarios_internos(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expira_en    timestamptz NOT NULL,
  usado_en     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tok_rec_vigencia CHECK (expira_en > created_at)
);
CREATE INDEX ix_tok_rec_usuario ON superadmin.tokens_recuperacion(usuario_id);

CREATE TABLE superadmin.sesiones_internas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   uuid        NOT NULL REFERENCES superadmin.usuarios_internos(id) ON DELETE CASCADE,
  cookie_hash  text        NOT NULL UNIQUE,
  ip           inet,
  user_agent   text,
  expira_en    timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ses_int_usuario ON superadmin.sesiones_internas(usuario_id);
CREATE INDEX ix_ses_int_expira  ON superadmin.sesiones_internas(expira_en);

CREATE TABLE superadmin.intentos_login (
  id         bigserial PRIMARY KEY,
  correo     citext      NOT NULL,
  ip         inet,
  exito      boolean     NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Ventana de bloqueo por intentos fallidos (RF-00.4)
CREATE INDEX ix_intentos_correo_ts ON superadmin.intentos_login(correo, created_at DESC);

-- --- Gimnasios (tenants) ----------------------------------------------
CREATE TABLE superadmin.gimnasios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id         uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- tenant id propagado a platform
  nombre              text        NOT NULL,
  subdominio          text        NOT NULL UNIQUE
                                  CHECK (subdominio ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$'),
  nit                 text,
  direccion           text,
  ciudad              text,
  telefono            text,
  correo              citext,
  estado              text        NOT NULL DEFAULT 'prueba'
                                  CHECK (estado IN ('prueba','activo','suspendido','cancelado')),
  fecha_inicio        date        NOT NULL DEFAULT current_date,
  fecha_corte         date,                       -- materializada; se recalcula desde pagos
  logo_url            text,
  banner_url          text,
  descripcion         text        CHECK (descripcion IS NULL OR length(descripcion) <= 300),
  instagram           text,
  facebook            text,
  whatsapp            text,
  motivo_cancelacion  text,
  fecha_cancelacion   timestamptz,
  version             integer     NOT NULL DEFAULT 1,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Coherencia de cancelación: si está cancelado, exige motivo y fecha
  CONSTRAINT gym_cancelacion_coherente CHECK (
    (estado <> 'cancelado')
    OR (motivo_cancelacion IS NOT NULL AND fecha_cancelacion IS NOT NULL)
  )
);
CREATE INDEX ix_gym_estado      ON superadmin.gimnasios(estado) WHERE deleted_at IS NULL;
CREATE INDEX ix_gym_fecha_corte ON superadmin.gimnasios(fecha_corte) WHERE deleted_at IS NULL;
CREATE INDEX ix_gym_nombre_trgm ON superadmin.gimnasios USING gin (nombre gin_trgm_ops);

CREATE TABLE superadmin.gimnasio_galeria (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  url          text        NOT NULL,
  orden        integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_galeria_gym ON superadmin.gimnasio_galeria(gimnasio_id);

CREATE TABLE superadmin.cuentas_jefe (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  nombre             text        NOT NULL,
  correo             citext      NOT NULL UNIQUE,
  telefono           text,
  password_cambiada  boolean     NOT NULL DEFAULT false,
  ultimo_ingreso     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Un solo Jefe por gimnasio (RF-40)
CREATE UNIQUE INDEX ux_jefe_por_gym ON superadmin.cuentas_jefe(gimnasio_id);

CREATE TABLE superadmin.notas_gimnasio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  autor_id     uuid        REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  texto        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notas_gym ON superadmin.notas_gimnasio(gimnasio_id, created_at DESC);

-- --- Suscripción y cobros ---------------------------------------------
-- Histórico: no se sobrescribe el valor anterior (RF-14)
CREATE TABLE superadmin.suscripciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  valor_mensual  numeric(12,2) NOT NULL CHECK (valor_mensual >= 0),
  tipo_inicio    text        NOT NULL CHECK (tipo_inicio IN ('prueba','cliente_activo')),
  vigente_desde  date        NOT NULL,
  vigente_hasta  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT susc_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE INDEX ix_susc_gym ON superadmin.suscripciones(gimnasio_id, vigente_desde DESC);

CREATE TABLE superadmin.pagos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       uuid          NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE RESTRICT,
  monto             numeric(12,2) NOT NULL CHECK (monto > 0),
  meses             integer       NOT NULL CHECK (meses > 0),
  fecha_pago        date          NOT NULL DEFAULT current_date,
  metodo            text          NOT NULL,   -- texto libre (decisión de producto)
  nota              text,
  anulado           boolean       NOT NULL DEFAULT false,
  motivo_anulacion  text,
  anulado_por       uuid          REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  anulado_en        timestamptz,
  idempotency_key   text          NOT NULL UNIQUE,
  registrado_por    uuid          REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  -- Anulación coherente: si está anulado exige motivo y fecha
  CONSTRAINT pago_anulacion_coherente CHECK (
    (anulado = false AND motivo_anulacion IS NULL AND anulado_en IS NULL)
    OR (anulado = true AND motivo_anulacion IS NOT NULL AND anulado_en IS NOT NULL)
  )
);
CREATE INDEX ix_pagos_gym ON superadmin.pagos(gimnasio_id, fecha_pago DESC);
-- Sólo los pagos no anulados alimentan fecha_corte
CREATE INDEX ix_pagos_vigentes ON superadmin.pagos(gimnasio_id) WHERE anulado = false;

-- --- Credenciales y soporte -------------------------------------------
-- Nunca se persiste la contraseña temporal: sólo la traza de emisión.
CREATE TABLE superadmin.emisiones_credenciales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id      uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  tipo             text        NOT NULL CHECK (tipo IN ('emitida','reenviada','regenerada')),
  expira_en        timestamptz NOT NULL,     -- emisión + 72h
  veces_reenviada  integer     NOT NULL DEFAULT 0 CHECK (veces_reenviada >= 0),
  enviada_por      uuid        REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_emis_gym ON superadmin.emisiones_credenciales(gimnasio_id, created_at DESC);

CREATE TABLE superadmin.sesiones_soporte (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  actor_id       uuid        NOT NULL REFERENCES superadmin.usuarios_internos(id) ON DELETE RESTRICT,
  motivo         text        NOT NULL CHECK (length(btrim(motivo)) > 0),  -- motivo obligatorio
  token_hash     text        NOT NULL UNIQUE,
  expira_en      timestamptz NOT NULL,     -- creación + 1h
  finalizada_en  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sop_gym ON superadmin.sesiones_soporte(gimnasio_id, created_at DESC);

-- --- Provisioning idempotente por paso --------------------------------
CREATE TABLE superadmin.provisioning_pasos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  paso         text        NOT NULL,
  estado       text        NOT NULL DEFAULT 'pendiente'
                           CHECK (estado IN ('pendiente','en_proceso','completado','fallido')),
  intentos     integer     NOT NULL DEFAULT 0,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, paso)   -- clave de la idempotencia por paso
);

-- --- Catálogo de importaciones ----------------------------------------
CREATE TABLE superadmin.importaciones_ejercicios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset        text        NOT NULL,
  total          integer     NOT NULL DEFAULT 0,
  actualizados   integer     NOT NULL DEFAULT 0,
  ignorados      integer     NOT NULL DEFAULT 0,
  omitidos       integer     NOT NULL DEFAULT 0,
  ejecutada_por  uuid        REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- --- Idempotencia de endpoints ----------------------------------------
CREATE TABLE superadmin.claves_idempotencia (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave       text        NOT NULL UNIQUE,
  endpoint    text        NOT NULL,
  respuesta   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL
);
CREATE INDEX ix_idem_expira ON superadmin.claves_idempotencia(expira_en);

-- --- Auditoría append-only con hash-chain -----------------------------
CREATE TABLE superadmin.auditoria (
  id            bigserial PRIMARY KEY,
  gimnasio_id   uuid,                       -- nullable: hay acciones no ligadas a un gimnasio
  actor_id      uuid,                       -- sin FK: sobrevive al borrado del usuario
  actor_nombre  text        NOT NULL,       -- desnormalizado a propósito
  impersonando  boolean     NOT NULL DEFAULT false,
  accion        text        NOT NULL,
  entidad       text        NOT NULL,
  entidad_id    text,
  detalle       jsonb,
  hash_previo   text,
  hash_actual   text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_aud_gym    ON superadmin.auditoria(gimnasio_id, created_at DESC);
CREATE INDEX ix_aud_actor  ON superadmin.auditoria(actor_id, created_at DESC);
CREATE INDEX ix_aud_accion ON superadmin.auditoria(accion, created_at DESC);

-- Inmutabilidad: prohibir UPDATE y DELETE por trigger
CREATE OR REPLACE FUNCTION superadmin.fn_auditoria_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria es append-only: % no permitido', TG_OP;
END$$;

CREATE TRIGGER tg_auditoria_no_update
  BEFORE UPDATE OR DELETE ON superadmin.auditoria
  FOR EACH ROW EXECUTE FUNCTION superadmin.fn_auditoria_inmutable();


-- =====================================================================
-- ESQUEMA platform — Sistema Web del Gimnasio + App del Deportista
-- Todas las tablas de negocio llevan gimnasio_id y RLS.
-- =====================================================================

-- --- Tenant: espejo operativo del gimnasio ----------------------------
-- El dueño del identificador es superadmin.gimnasios.gimnasio_id;
-- esta fila la crea el provisioning con EL MISMO valor.
CREATE TABLE platform.tenant (
  id                       uuid PRIMARY KEY,     -- = superadmin.gimnasios.gimnasio_id
  nombre                   text        NOT NULL,
  subdominio               text        NOT NULL UNIQUE,
  zona_horaria             text        NOT NULL DEFAULT 'America/Bogota',
  dias_gracia_mora         integer     NOT NULL DEFAULT 3  CHECK (dias_gracia_mora >= 0),
  tope_dias_congelamiento  integer     NOT NULL DEFAULT 30 CHECK (tope_dias_congelamiento >= 0),
  metodos_pago             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  horarios                 jsonb,
  landing_slug             text,
  activo                   boolean     NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- --- Personal del gimnasio --------------------------------------------
CREATE TABLE platform.staff (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  correo          citext      NOT NULL,
  hash_password   text        NOT NULL,
  rol             text        NOT NULL CHECK (rol IN ('jefe','recepcionista','entrenador')),
  activo          boolean     NOT NULL DEFAULT true,
  ultimo_ingreso  timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, correo)
);
-- Jefe único por gimnasio (RF-40): a lo sumo un staff activo con rol 'jefe'
CREATE UNIQUE INDEX ux_un_jefe_por_gym
  ON platform.staff(gimnasio_id)
  WHERE rol = 'jefe' AND deleted_at IS NULL;
CREATE INDEX ix_staff_gym ON platform.staff(gimnasio_id) WHERE deleted_at IS NULL;

-- Matriz de permisos configurable por el Jefe (RF-00.5)
CREATE TABLE platform.permisos_rol (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  rol             text        NOT NULL CHECK (rol IN ('jefe','recepcionista','entrenador')),
  submodulo       text        NOT NULL,
  puede_crear     boolean     NOT NULL DEFAULT false,
  puede_leer      boolean     NOT NULL DEFAULT false,
  puede_editar    boolean     NOT NULL DEFAULT false,
  puede_eliminar  boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, rol, submodulo)
);

CREATE TABLE platform.sesiones_staff (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id   uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  staff_id      uuid        NOT NULL REFERENCES platform.staff(id) ON DELETE CASCADE,
  refresh_hash  text        NOT NULL UNIQUE,
  expira_en     timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ses_staff ON platform.sesiones_staff(staff_id);

-- FALTABA: recuperación de contraseña del staff (RF-00.2)
CREATE TABLE platform.tokens_recuperacion_staff (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  staff_id     uuid        NOT NULL REFERENCES platform.staff(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expira_en    timestamptz NOT NULL,
  usado_en     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tok_staff ON platform.tokens_recuperacion_staff(staff_id);

-- FALTABA: bloqueo por intentos fallidos del staff (RF-00.4)
CREATE TABLE platform.intentos_login_staff (
  id           bigserial PRIMARY KEY,
  gimnasio_id  uuid        REFERENCES platform.tenant(id) ON DELETE CASCADE,
  correo       citext      NOT NULL,
  ip           inet,
  exito        boolean     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_intentos_staff ON platform.intentos_login_staff(correo, created_at DESC);

-- --- Deportistas -------------------------------------------------------
CREATE TABLE platform.deportistas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id           uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  documento             text        NOT NULL,
  nombre                text        NOT NULL,
  correo                citext,                     -- repetible: plan familiar/pareja
  telefono              text,
  sexo                  text        CHECK (sexo IS NULL OR sexo IN ('M','F','otro')),
  fecha_nacimiento      date,
  altura_cm             numeric(5,2) CHECK (altura_cm IS NULL OR altura_cm > 0),
  consentimiento_1581   boolean     NOT NULL DEFAULT false,
  consentimiento_fecha  timestamptz,
  acudiente_nombre      text,
  activo                boolean     NOT NULL DEFAULT true,
  version               integer     NOT NULL DEFAULT 1,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Sin consentimiento no se completa la inscripción (RF-19)
  CONSTRAINT dep_consentimiento CHECK (
    consentimiento_1581 = false OR consentimiento_fecha IS NOT NULL
  )
);
-- Documento único POR GIMNASIO, no global
CREATE UNIQUE INDEX ux_dep_documento_gym
  ON platform.deportistas(gimnasio_id, documento) WHERE deleted_at IS NULL;
CREATE INDEX ix_dep_nombre_trgm ON platform.deportistas USING gin (nombre gin_trgm_ops);
CREATE INDEX ix_dep_gym ON platform.deportistas(gimnasio_id) WHERE deleted_at IS NULL;

-- Plantillas biométricas: dato sensible (Ley 1581), cifradas en aplicación
CREATE TABLE platform.huellas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id     uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  dedo              text        NOT NULL,
  template_cifrado  bytea       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deportista_id, dedo)
);
CREATE INDEX ix_huellas_dep ON platform.huellas(deportista_id);

-- Mediciones: las registra SOLO el staff (la app es solo lectura)
CREATE TABLE platform.mediciones_corporales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id   uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT current_date,
  peso            numeric(6,2) CHECK (peso IS NULL OR peso > 0),
  grasa_pct       numeric(5,2) CHECK (grasa_pct IS NULL OR (grasa_pct >= 0 AND grasa_pct <= 100)),
  masa_muscular   numeric(6,2),
  cintura         numeric(6,2),
  cadera          numeric(6,2),
  brazo           numeric(6,2),
  pierna          numeric(6,2),
  pecho           numeric(6,2),
  registrado_por  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_medic_dep ON platform.mediciones_corporales(deportista_id, fecha DESC);

-- --- Membresías --------------------------------------------------------
CREATE TABLE platform.planes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  nombre         text        NOT NULL,
  precio         numeric(12,2) NOT NULL CHECK (precio >= 0),
  duracion_dias  integer     NOT NULL CHECK (duracion_dias > 0),
  tipo           text        NOT NULL CHECK (tipo IN ('individual','pareja','familiar')),
  cupo_personas  integer     NOT NULL DEFAULT 1 CHECK (cupo_personas >= 1),
  activo         boolean     NOT NULL DEFAULT true,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, nombre)
);

-- El ESTADO del deportista (activo/por vencer/vencido/congelado/...) NO se
-- almacena: se deriva de fecha_vencimiento, congelamientos y tenant.dias_gracia_mora.
CREATE TABLE platform.membresias (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id      uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  plan_id            uuid        NOT NULL REFERENCES platform.planes(id) ON DELETE RESTRICT,
  fecha_inicio       date        NOT NULL DEFAULT current_date,
  fecha_vencimiento  date        NOT NULL,
  cancelada          boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memb_fechas CHECK (fecha_vencimiento >= fecha_inicio)
);
CREATE INDEX ix_memb_dep ON platform.membresias(deportista_id, fecha_vencimiento DESC);
-- Reporte "por vencer" accionable (RF-42)
CREATE INDEX ix_memb_vencimiento
  ON platform.membresias(gimnasio_id, fecha_vencimiento) WHERE cancelada = false;

-- Congelar extiende el vencimiento por los días congelados (RF-26)
CREATE TABLE platform.congelamientos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  membresia_id    uuid        NOT NULL REFERENCES platform.membresias(id) ON DELETE CASCADE,
  fecha_inicio    date        NOT NULL,
  fecha_fin       date,                       -- null = congelamiento vigente
  dias            integer     CHECK (dias IS NULL OR dias >= 0),
  registrado_por  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cong_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);
-- Un solo congelamiento vigente por membresía
CREATE UNIQUE INDEX ux_cong_vigente
  ON platform.congelamientos(membresia_id) WHERE fecha_fin IS NULL;

-- --- Control de ingreso -------------------------------------------------
-- ts_utc es la fuente de verdad; el "día" se decide siempre en servidor.
CREATE TABLE platform.checkins (
  id               bigserial PRIMARY KEY,
  gimnasio_id      uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id    uuid        REFERENCES platform.deportistas(id) ON DELETE SET NULL, -- NULL = cortesía
  tipo             text        NOT NULL CHECK (tipo IN ('ingreso','cortesia')),
  metodo           text        NOT NULL CHECK (metodo IN ('huella','manual')),
  resultado        text        NOT NULL CHECK (resultado IN ('abrio','alerta_mora','negado')),
  motivo_cortesia  text,
  registrado_por   uuid        REFERENCES platform.staff(id) ON DELETE SET NULL, -- NULL = huella automática
  ts_utc           timestamptz NOT NULL DEFAULT now(),
  -- Cortesía exige motivo y no lleva deportista; ingreso exige deportista
  CONSTRAINT chk_cortesia CHECK (
    (tipo = 'cortesia' AND deportista_id IS NULL AND motivo_cortesia IS NOT NULL)
    OR (tipo = 'ingreso' AND deportista_id IS NOT NULL)
  )
);
CREATE INDEX ix_checkin_gym_ts ON platform.checkins(gimnasio_id, ts_utc DESC);
CREATE INDEX ix_checkin_dep_ts ON platform.checkins(deportista_id, ts_utc DESC);

-- --- Caja ---------------------------------------------------------------
CREATE TABLE platform.turnos_caja (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  staff_id          uuid        NOT NULL REFERENCES platform.staff(id) ON DELETE RESTRICT,
  base_inicial      numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_inicial >= 0),
  abierto_en        timestamptz NOT NULL DEFAULT now(),
  cerrado_en        timestamptz,
  efectivo_contado  numeric(12,2),
  diferencia        numeric(12,2),
  estado            text        NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  cierre_forzado    boolean     NOT NULL DEFAULT false,
  estado_revision   text        CHECK (estado_revision IS NULL
                                       OR estado_revision IN ('pendiente_revision','revisado')),
  revisado_por      uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  revisado_en       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT turno_cierre_coherente CHECK (
    (estado = 'abierto' AND cerrado_en IS NULL)
    OR (estado = 'cerrado' AND cerrado_en IS NOT NULL)
  )
);
-- Un solo turno abierto por usuario de caja
CREATE UNIQUE INDEX ux_turno_abierto_por_staff
  ON platform.turnos_caja(staff_id) WHERE estado = 'abierto';
CREATE INDEX ix_turno_gym ON platform.turnos_caja(gimnasio_id, abierto_en DESC);

CREATE TABLE platform.productos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  nombre       text        NOT NULL,
  precio       numeric(12,2) NOT NULL CHECK (precio >= 0),
  stock        integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),  -- no se vende bajo cero
  activo       boolean     NOT NULL DEFAULT true,
  version      integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, nombre)
);

CREATE TABLE platform.stock_movimientos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  producto_id     uuid        NOT NULL REFERENCES platform.productos(id) ON DELETE RESTRICT,
  tipo            text        NOT NULL CHECK (tipo IN ('entrada','ajuste','venta','devolucion')),
  cantidad        integer     NOT NULL CHECK (cantidad <> 0),
  motivo          text,
  registrado_por  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_stockmov_prod ON platform.stock_movimientos(producto_id, created_at DESC);

CREATE TABLE platform.ventas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  turno_id          uuid        NOT NULL REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  deportista_id     uuid        REFERENCES platform.deportistas(id) ON DELETE SET NULL, -- NULL = walk-in
  total             numeric(12,2) NOT NULL CHECK (total >= 0),
  metodo            text        NOT NULL,
  tipo_medio        text        NOT NULL CHECK (tipo_medio IN ('efectivo','otro')),
  valor_recibido    numeric(12,2) CHECK (valor_recibido IS NULL OR valor_recibido >= 0),
  anulada           boolean     NOT NULL DEFAULT false,
  motivo_anulacion  text,
  anulada_por       uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  anulada_en        timestamptz,
  idempotency_key   text        NOT NULL,
  registrada_por    uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, idempotency_key),
  CONSTRAINT venta_anulacion_coherente CHECK (
    (anulada = false AND motivo_anulacion IS NULL AND anulada_en IS NULL)
    OR (anulada = true AND motivo_anulacion IS NOT NULL AND anulada_en IS NOT NULL)
  )
);
CREATE INDEX ix_ventas_turno ON platform.ventas(turno_id);
CREATE INDEX ix_ventas_gym   ON platform.ventas(gimnasio_id, created_at DESC);

CREATE TABLE platform.venta_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id      uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  venta_id         uuid        NOT NULL REFERENCES platform.ventas(id) ON DELETE CASCADE,
  tipo             text        NOT NULL CHECK (tipo IN ('producto','membresia','pase_dia','pase_clase')),
  producto_id      uuid        REFERENCES platform.productos(id) ON DELETE RESTRICT,
  descripcion      text        NOT NULL,
  cantidad         integer     NOT NULL CHECK (cantidad > 0),
  precio_unitario  numeric(12,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal         numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  -- Si el ítem es producto, exige producto_id
  CONSTRAINT item_producto CHECK (tipo <> 'producto' OR producto_id IS NOT NULL)
);
CREATE INDEX ix_items_venta ON platform.venta_items(venta_id);

-- El efectivo sale del turno ACTUAL, que puede diferir del turno de la venta
CREATE TABLE platform.devoluciones (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id              uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  venta_original_id        uuid        NOT NULL REFERENCES platform.ventas(id) ON DELETE RESTRICT,
  turno_venta_original_id  uuid        NOT NULL REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  turno_devolucion_id      uuid        NOT NULL REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  monto                    numeric(12,2) NOT NULL CHECK (monto > 0),
  motivo                   text        NOT NULL,
  registrada_por           uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_dev_venta ON platform.devoluciones(venta_original_id);
CREATE INDEX ix_dev_turno ON platform.devoluciones(turno_devolucion_id);

CREATE TABLE platform.pagos_membresia (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  turno_id          uuid        NOT NULL REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  membresia_id      uuid        NOT NULL REFERENCES platform.membresias(id) ON DELETE RESTRICT,
  monto             numeric(12,2) NOT NULL CHECK (monto > 0),
  metodo            text        NOT NULL,
  tipo_medio        text        NOT NULL CHECK (tipo_medio IN ('efectivo','otro')),
  dias_agregados    integer     NOT NULL CHECK (dias_agregados >= 0),
  anulado           boolean     NOT NULL DEFAULT false,
  motivo_anulacion  text,
  anulado_por       uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  anulado_en        timestamptz,
  idempotency_key   text        NOT NULL,
  registrado_por    uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, idempotency_key),
  CONSTRAINT pagomemb_anulacion_coherente CHECK (
    (anulado = false AND motivo_anulacion IS NULL AND anulado_en IS NULL)
    OR (anulado = true AND motivo_anulacion IS NOT NULL AND anulado_en IS NOT NULL)
  )
);
CREATE INDEX ix_pagomemb_turno ON platform.pagos_membresia(turno_id);
CREATE INDEX ix_pagomemb_memb  ON platform.pagos_membresia(membresia_id);

-- Vales/egresos: pueden dejar la caja en negativo (decisión de producto)
CREATE TABLE platform.egresos_caja (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  turno_id        uuid        NOT NULL REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  motivo          text        NOT NULL,
  monto           numeric(12,2) NOT NULL CHECK (monto > 0),
  registrado_por  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_egresos_turno ON platform.egresos_caja(turno_id);

-- --- Catálogo de ejercicios --------------------------------------------
-- gimnasio_id NULL = ejercicio global (lo administra el Super-Admin con un
-- usuario de BD de sólo catálogo). gimnasio_id seteado = ejercicio propio.
CREATE TABLE platform.ejercicios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        REFERENCES platform.tenant(id) ON DELETE CASCADE,
  propio          boolean     NOT NULL DEFAULT false,
  nombre_es       text        NOT NULL,
  nombre_en       text,
  instrucciones   text,
  grupo_muscular  text,
  equipo          text,
  categoria       text,
  archivo_url     text,                       -- GIF
  activo          boolean     NOT NULL DEFAULT true,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Coherencia: propio=true exige gimnasio_id; global exige gimnasio_id NULL
  CONSTRAINT ejer_propiedad CHECK (
    (propio = true AND gimnasio_id IS NOT NULL)
    OR (propio = false AND gimnasio_id IS NULL)
  )
);
CREATE INDEX ix_ejer_global ON platform.ejercicios(activo) WHERE gimnasio_id IS NULL;
CREATE INDEX ix_ejer_gym    ON platform.ejercicios(gimnasio_id) WHERE gimnasio_id IS NOT NULL;
CREATE INDEX ix_ejer_nombre_trgm ON platform.ejercicios USING gin (nombre_es gin_trgm_ops);

-- Activación por gimnasio de los ejercicios GLOBALES (RF-28).
-- No aplica a los propios: ésos usan ejercicios.activo.
CREATE TABLE platform.gimnasio_ejercicio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  ejercicio_id   uuid        NOT NULL REFERENCES platform.ejercicios(id) ON DELETE CASCADE,
  activo_en_gym  boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, ejercicio_id)
);

-- --- Entrenamiento (Sistema Web) ---------------------------------------
CREATE TABLE platform.rutinas_plantilla (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  entrenador_id  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  nombre         text        NOT NULL,
  descripcion    text,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_plant_gym ON platform.rutinas_plantilla(gimnasio_id);

CREATE TABLE platform.rutina_plantilla_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  plantilla_id   uuid        NOT NULL REFERENCES platform.rutinas_plantilla(id) ON DELETE CASCADE,
  ejercicio_id   uuid        NOT NULL REFERENCES platform.ejercicios(id) ON DELETE RESTRICT,
  orden          integer     NOT NULL DEFAULT 0,
  series         integer     CHECK (series IS NULL OR series > 0),
  reps           text,
  peso_sugerido  text,
  descanso_seg   integer     CHECK (descanso_seg IS NULL OR descanso_seg >= 0)
);
CREATE INDEX ix_plant_items ON platform.rutina_plantilla_items(plantilla_id, orden);

-- SNAPSHOT: los items son una COPIA congelada al momento de asignar.
-- Editar la plantilla NO debe modificar estos registros (RF-30).
CREATE TABLE platform.rutinas_asignadas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  plantilla_id   uuid        REFERENCES platform.rutinas_plantilla(id) ON DELETE SET NULL, -- sólo origen
  entrenador_id  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  nombre         text        NOT NULL,
  asignada_en    timestamptz NOT NULL DEFAULT now(),
  activa         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rutasig_dep ON platform.rutinas_asignadas(deportista_id) WHERE activa = true;

CREATE TABLE platform.rutina_asignada_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id         uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  rutina_asignada_id  uuid        NOT NULL REFERENCES platform.rutinas_asignadas(id) ON DELETE CASCADE,
  ejercicio_id        uuid        NOT NULL REFERENCES platform.ejercicios(id) ON DELETE RESTRICT,
  orden               integer     NOT NULL DEFAULT 0,
  series              integer     CHECK (series IS NULL OR series > 0),
  reps                text,
  peso_sugerido       text,
  descanso_seg        integer     CHECK (descanso_seg IS NULL OR descanso_seg >= 0)
);
CREATE INDEX ix_rutasig_items ON platform.rutina_asignada_items(rutina_asignada_id, orden);

-- --- Clases -------------------------------------------------------------
CREATE TABLE platform.clases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  nombre             text        NOT NULL,
  tipo               text,
  entrenador_id      uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  profesor_externo   text,
  cupo               integer     NOT NULL CHECK (cupo > 0),
  fecha_hora         timestamptz NOT NULL,
  recurrente         boolean     NOT NULL DEFAULT false,
  regla_recurrencia  text,
  omitir_festivos    boolean     NOT NULL DEFAULT false,
  estado             text        NOT NULL DEFAULT 'programada'
                                 CHECK (estado IN ('programada','cancelada','realizada')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Debe tener profesor del sistema O etiqueta externa
  CONSTRAINT clase_profesor CHECK (entrenador_id IS NOT NULL OR profesor_externo IS NOT NULL),
  CONSTRAINT clase_recurrencia CHECK (recurrente = false OR regla_recurrencia IS NOT NULL)
);
CREATE INDEX ix_clases_gym_fecha ON platform.clases(gimnasio_id, fecha_hora);

CREATE TABLE platform.reservas_clase (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  clase_id       uuid        NOT NULL REFERENCES platform.clases(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  estado         text        NOT NULL DEFAULT 'reservada'
                             CHECK (estado IN ('reservada','cancelada','asistio','no_show')),
  pase_pagado    boolean     NOT NULL DEFAULT false,  -- vencido/congelado paga la clase
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Una reserva vigente por deportista y clase
CREATE UNIQUE INDEX ux_reserva_vigente
  ON platform.reservas_clase(clase_id, deportista_id) WHERE estado <> 'cancelada';
CREATE INDEX ix_reservas_clase ON platform.reservas_clase(clase_id);

-- El check-in de clase EXIGE haber ingresado al gimnasio (checkin_id).
CREATE TABLE platform.asistencia_clase (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  clase_id       uuid        NOT NULL REFERENCES platform.clases(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  checkin_id     bigint      NOT NULL REFERENCES platform.checkins(id) ON DELETE RESTRICT,
  check_in       timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clase_id, deportista_id)
);

CREATE TABLE platform.calificaciones_clase (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  clase_id       uuid        NOT NULL REFERENCES platform.clases(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  puntaje        integer     NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clase_id, deportista_id)
);

-- --- Auditoría del gimnasio --------------------------------------------
CREATE TABLE platform.auditoria_gym (
  id            bigserial PRIMARY KEY,
  gimnasio_id   uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  actor_id      uuid,
  actor_nombre  text        NOT NULL,
  impersonando  boolean     NOT NULL DEFAULT false,  -- soporte del Super-Admin
  accion        text        NOT NULL,
  entidad       text        NOT NULL,
  entidad_id    text,
  detalle       jsonb,
  hash_previo   text,
  hash_actual   text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audgym_gym    ON platform.auditoria_gym(gimnasio_id, created_at DESC);
CREATE INDEX ix_audgym_accion ON platform.auditoria_gym(accion, created_at DESC);

CREATE OR REPLACE FUNCTION platform.fn_auditoria_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_gym es append-only: % no permitido', TG_OP;
END$$;

CREATE TRIGGER tg_audgym_no_update
  BEFORE UPDATE OR DELETE ON platform.auditoria_gym
  FOR EACH ROW EXECUTE FUNCTION platform.fn_auditoria_inmutable();


-- =====================================================================
-- APP DEL DEPORTISTA (mismo esquema platform)
-- =====================================================================

-- La app es OPCIONAL: el deportista opera sin activarla.
-- El correo es único a nivel de cuentas de app, aunque en deportistas se repita.
CREATE TABLE platform.cuentas_app (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id     uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id   uuid        NOT NULL UNIQUE REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  correo          citext      NOT NULL UNIQUE,
  hash_password   text        NOT NULL,
  activa          boolean     NOT NULL DEFAULT true,
  ultimo_ingreso  timestamptz,
  notif_clases    boolean     NOT NULL DEFAULT true,
  notif_rutinas   boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Invitación para activar la app (enlace/código)
CREATE TABLE platform.invitaciones_app (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  codigo_hash    text        NOT NULL UNIQUE,
  estado         text        NOT NULL DEFAULT 'pendiente'
                             CHECK (estado IN ('pendiente','usada','expirada')),
  expira_en      timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_invapp_dep ON platform.invitaciones_app(deportista_id);

CREATE TABLE platform.notificaciones_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  cuenta_app_id  uuid        NOT NULL REFERENCES platform.cuentas_app(id) ON DELETE CASCADE,
  fcm_token      text        NOT NULL UNIQUE,
  plataforma     text        NOT NULL CHECK (plataforma IN ('android','ios')),
  activo         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_fcm_cuenta ON platform.notificaciones_tokens(cuenta_app_id);

CREATE TABLE platform.cuestionario_experiencia (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id      uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  tiene_experiencia  boolean     NOT NULL,
  objetivos          text,
  condicion_fisica   text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.rutinas_personalizadas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  nombre         text        NOT NULL,
  favorita       boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rutper_dep ON platform.rutinas_personalizadas(deportista_id);

CREATE TABLE platform.rutina_personalizada_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id   uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  rutina_id     uuid        NOT NULL REFERENCES platform.rutinas_personalizadas(id) ON DELETE CASCADE,
  ejercicio_id  uuid        NOT NULL REFERENCES platform.ejercicios(id) ON DELETE RESTRICT,
  orden         integer     NOT NULL DEFAULT 0,
  series        integer     CHECK (series IS NULL OR series > 0),
  reps          text,
  descanso_seg  integer     CHECK (descanso_seg IS NULL OR descanso_seg >= 0)
);
CREATE INDEX ix_rutper_items ON platform.rutina_personalizada_items(rutina_id, orden);

-- Sesión de entrenamiento: proviene de una rutina asignada O de una personalizada.
-- Dos FK nullables con CHECK de exclusividad (integridad garantizada por el motor).
CREATE TABLE platform.sesiones_entrenamiento (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id              uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id            uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  rutina_asignada_id       uuid        REFERENCES platform.rutinas_asignadas(id) ON DELETE SET NULL,
  rutina_personalizada_id  uuid        REFERENCES platform.rutinas_personalizadas(id) ON DELETE SET NULL,
  inicio                   timestamptz NOT NULL DEFAULT now(),
  fin                      timestamptz,
  duracion_min             integer     CHECK (duracion_min IS NULL OR duracion_min >= 0),
  calificacion             integer     CHECK (calificacion IS NULL OR calificacion BETWEEN 1 AND 5),
  nota                     text,
  sincronizada             boolean     NOT NULL DEFAULT true,   -- false = pendiente de sync offline
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sesion_origen_exclusivo CHECK (
    (rutina_asignada_id IS NOT NULL AND rutina_personalizada_id IS NULL)
    OR (rutina_asignada_id IS NULL AND rutina_personalizada_id IS NOT NULL)
    OR (rutina_asignada_id IS NULL AND rutina_personalizada_id IS NULL)  -- sesión libre
  ),
  CONSTRAINT sesion_fechas CHECK (fin IS NULL OR fin >= inicio)
);
CREATE INDEX ix_sesent_dep ON platform.sesiones_entrenamiento(deportista_id, inicio DESC);
-- Purga de registros offline no sincronizados (TTL 7 días)
CREATE INDEX ix_sesent_sync ON platform.sesiones_entrenamiento(created_at) WHERE sincronizada = false;

CREATE TABLE platform.sesion_series (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id   uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  sesion_id     uuid        NOT NULL REFERENCES platform.sesiones_entrenamiento(id) ON DELETE CASCADE,
  ejercicio_id  uuid        NOT NULL REFERENCES platform.ejercicios(id) ON DELETE RESTRICT,
  serie_num     integer     NOT NULL CHECK (serie_num > 0),
  reps          integer     CHECK (reps IS NULL OR reps >= 0),
  peso          numeric(6,2) CHECK (peso IS NULL OR peso >= 0)
);
CREATE INDEX ix_series_sesion ON platform.sesion_series(sesion_id);

-- Calificación anónima al entrenador: una por periodo (RF-39).
-- El promedio lo ven el Jefe y el propio entrenador; nunca el detalle nominal.
CREATE TABLE platform.calificaciones_entrenador (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  entrenador_id  uuid        NOT NULL REFERENCES platform.staff(id) ON DELETE CASCADE,
  periodo        text        NOT NULL,          -- p.ej. '2026-09'
  puntaje        integer     NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deportista_id, entrenador_id, periodo)   -- una por periodo
);
CREATE INDEX ix_calent_entrenador ON platform.calificaciones_entrenador(entrenador_id, periodo);

-- Racha: se alimenta de check-in al gimnasio, sesión en la app o clase asistida
CREATE TABLE platform.rachas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id      uuid        NOT NULL UNIQUE REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  dias_consecutivos  integer     NOT NULL DEFAULT 0 CHECK (dias_consecutivos >= 0),
  ultima_actividad   date,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Catálogo global de logros (iguales para todos los gimnasios)
CREATE TABLE platform.logros (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       text        NOT NULL UNIQUE,
  nombre       text        NOT NULL,
  descripcion  text,
  umbral       integer     NOT NULL DEFAULT 1
);

CREATE TABLE platform.logros_obtenidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  logro_id       uuid        NOT NULL REFERENCES platform.logros(id) ON DELETE CASCADE,
  obtenido_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deportista_id, logro_id)
);

CREATE TABLE platform.ranking_periodos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  deportista_id  uuid        NOT NULL REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  periodo        text        NOT NULL,
  puntos         integer     NOT NULL DEFAULT 0,
  visible        boolean     NOT NULL DEFAULT true,   -- el deportista decide (RF-32)
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, deportista_id, periodo)
);
CREATE INDEX ix_ranking ON platform.ranking_periodos(gimnasio_id, periodo, puntos DESC);


-- =====================================================================
-- ROW-LEVEL SECURITY (aislamiento entre gimnasios)
-- La aplicación fija por sesión:  SET LOCAL app.gimnasio_id = '<uuid>';
-- =====================================================================

CREATE OR REPLACE FUNCTION platform.current_gimnasio_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.gimnasio_id', true), '')::uuid;
$$;

-- Aplica RLS a todas las tablas de platform que tengan columna gimnasio_id
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'platform'
      AND c.relkind = 'r'
      AND a.attname = 'gimnasio_id'
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY;', t.relname);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY;', t.relname);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON platform.%I
      USING (
        gimnasio_id = platform.current_gimnasio_id()
        OR platform.current_gimnasio_id() IS NULL   -- sesión sin tenant: sólo para jobs/admin
      )
      WITH CHECK (gimnasio_id = platform.current_gimnasio_id());
    $f$, t.relname);
  END LOOP;
END$$;

-- 'tenant' se aísla por su PK (no tiene columna gimnasio_id)
ALTER TABLE platform.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON platform.tenant
  USING (id = platform.current_gimnasio_id() OR platform.current_gimnasio_id() IS NULL);

-- 'ejercicios': el catálogo global (gimnasio_id NULL) es visible para todos
DROP POLICY IF EXISTS tenant_isolation ON platform.ejercicios;
CREATE POLICY ejercicios_global_y_propios ON platform.ejercicios
  USING (
    gimnasio_id IS NULL                                   -- catálogo global
    OR gimnasio_id = platform.current_gimnasio_id()       -- propios del gimnasio
    OR platform.current_gimnasio_id() IS NULL
  )
  WITH CHECK (
    gimnasio_id = platform.current_gimnasio_id()
    OR (gimnasio_id IS NULL AND platform.current_gimnasio_id() IS NULL)
  );


-- =====================================================================
-- PERMISOS POR USUARIO DE BD (aislamiento entre esquemas)
-- =====================================================================

-- Super-Admin: dueño de su esquema, sin acceso a datos de tenants...
GRANT USAGE ON SCHEMA superadmin TO gymos_superadmin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA superadmin TO gymos_superadmin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA superadmin TO gymos_superadmin;

-- ...excepto la administración del CATÁLOGO de ejercicios, que vive en platform.
GRANT USAGE ON SCHEMA platform TO gymos_superadmin;
GRANT SELECT, INSERT, UPDATE ON platform.ejercicios TO gymos_superadmin;
-- y la creación del tenant durante el provisioning
GRANT SELECT, INSERT, UPDATE ON platform.tenant TO gymos_superadmin;

-- Plataforma: acceso completo a su esquema, nada del Super-Admin
GRANT USAGE ON SCHEMA platform TO gymos_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO gymos_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO gymos_platform;
-- Nota: gymos_platform NO recibe permisos sobre el esquema superadmin.

-- Defaults para tablas futuras
ALTER DEFAULT PRIVILEGES IN SCHEMA superadmin
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gymos_superadmin;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gymos_platform;


-- =====================================================================
-- NOTAS DE IMPLEMENTACIÓN (contrato para el equipo)
-- =====================================================================
-- 1. ESTADOS DERIVADOS: el estado del deportista (activo / por vencer /
--    vencido=mora / congelado / inactivo / cancelado) NO se almacena.
--    Se calcula con membresias.fecha_vencimiento, congelamientos vigentes
--    y tenant.dias_gracia_mora.
-- 2. fecha_corte de un gimnasio se recalcula SIEMPRE desde el historial de
--    pagos no anulados. Nunca se restaura un "valor anterior".
-- 3. SNAPSHOT de rutinas: rutina_asignada_items es una copia inmutable.
--    Editar la plantilla no debe propagarse a lo ya asignado.
-- 4. TRANSACCIONALIDAD: venta + venta_items + stock_movimientos van en una
--    sola transacción (todo o nada). Igual pago_membresia + extensión.
-- 5. IDEMPOTENCIA: ventas y pagos_membresia exigen idempotency_key del cliente.
--    Check-in ignora relecturas del mismo deportista dentro de 3 segundos.
-- 6. ZONA HORARIA: todo en UTC (timestamptz). La conversión a America/Bogota
--    ocurre en presentación y en el corte de reportes/caja (medianoche local).
-- 7. BIOMETRÍA (Ley 1581): huellas.template_cifrado se cifra en la aplicación.
--    Al ejercer supresión se borra de inmediato; los backups que la contengan
--    expiran en máximo 30 días.
-- 8. La app es OPCIONAL: un deportista sin cuentas_app opera con normalidad.
-- =====================================================================
