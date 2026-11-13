-- GymDesk Escritorio · esquema local · fase 1 (activación y sincronización)

-- Credencial y datos de la estación tras activarla. El device_token solo vive aquí, en la base cifrada.
ALTER TABLE estacion ADD COLUMN estacion_servidor_id TEXT;
ALTER TABLE estacion ADD COLUMN estacion_nombre TEXT;
ALTER TABLE estacion ADD COLUMN device_token TEXT;
ALTER TABLE estacion ADD COLUMN api_base TEXT;
-- El Jefe revocó la estación: deja de sincronizar y de operar.
ALTER TABLE estacion ADD COLUMN revocada_en TEXT;

-- Lo que el servidor sabe del personal. hash_password y hash_pin siguen siendo solo locales.
ALTER TABLE staff_local ADD COLUMN eliminado INTEGER NOT NULL DEFAULT 0 CHECK (eliminado IN (0,1));
-- Fecha en que la contraseña cambió en la web, según la última descarga.
ALTER TABLE staff_local ADD COLUMN password_cambiada_en TEXT;
-- Valor de esa fecha cuando se creó el verificador local. Si dejan de coincidir, el verificador
-- y el PIN se invalidan y la persona debe entrar de nuevo con red (E-19).
ALTER TABLE staff_local ADD COLUMN credencial_marca TEXT;

CREATE TABLE gimnasio (
  id                       TEXT PRIMARY KEY,
  nombre                   TEXT NOT NULL,
  subdominio               TEXT NOT NULL,
  zona_horaria             TEXT NOT NULL,
  dias_gracia_mora         INTEGER NOT NULL,
  dias_umbral_por_vencer   INTEGER NOT NULL,
  permitir_descuentos      INTEGER NOT NULL,
  tope_descuento_pct       INTEGER NOT NULL,
  metodos_pago             TEXT NOT NULL,   -- JSON
  branding                 TEXT NOT NULL,   -- JSON
  duracion_sesion_minutos  INTEGER NOT NULL
);

-- Suscripción del gimnasio al servicio. Con fecha_corte la estación calcula el aviso y el bloqueo
-- por su cuenta (P-01): quitar la red no lo evita.
CREATE TABLE suscripcion (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  estado_guardado        TEXT,
  fecha_corte            TEXT,             -- AAAA-MM-DD
  -- El servidor respondió "gimnasio suspendido" en la última descarga.
  bloqueado_por_servidor INTEGER NOT NULL DEFAULT 0 CHECK (bloqueado_por_servidor IN (0,1)),
  motivo_servidor        TEXT,
  actualizada_en         TEXT
);
INSERT INTO suscripcion (id) VALUES (1);

CREATE TABLE permisos_rol (
  id              TEXT PRIMARY KEY,
  rol             TEXT NOT NULL,
  submodulo       TEXT NOT NULL,
  puede_crear     INTEGER NOT NULL,
  puede_leer      INTEGER NOT NULL,
  puede_editar    INTEGER NOT NULL,
  puede_eliminar  INTEGER NOT NULL
);

CREATE TABLE planes (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  precio         INTEGER NOT NULL,          -- COP enteros
  duracion_dias  INTEGER NOT NULL,
  tipo           TEXT NOT NULL,
  cupo_personas  INTEGER NOT NULL,
  activo         INTEGER NOT NULL
);

CREATE TABLE productos (
  id      TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  precio  INTEGER NOT NULL,                 -- COP enteros
  stock   INTEGER NOT NULL,
  activo  INTEGER NOT NULL
);

-- Solo lo mínimo para recepción (E-20).
CREATE TABLE deportistas (
  id              TEXT PRIMARY KEY,
  tipo_documento  TEXT,
  documento       TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  activo          INTEGER NOT NULL,
  eliminado       INTEGER NOT NULL
);
CREATE INDEX ix_deportistas_documento ON deportistas(documento);

CREATE TABLE membresias (
  id                 TEXT PRIMARY KEY,
  deportista_id      TEXT NOT NULL,
  plan_id            TEXT NOT NULL,
  fecha_inicio       TEXT NOT NULL,
  fecha_vencimiento  TEXT NOT NULL,
  cancelada          INTEGER NOT NULL
);
CREATE INDEX ix_membresias_deportista ON membresias(deportista_id, fecha_vencimiento DESC);

-- Estado de la sincronización.
CREATE TABLE sync_estado (
  id                         INTEGER PRIMARY KEY CHECK (id = 1),
  cursor                     TEXT,
  descarga_inicial_completa  INTEGER NOT NULL DEFAULT 0 CHECK (descarga_inicial_completa IN (0,1)),
  ultima_descarga_ok         TEXT,
  ultimo_envio_ok            TEXT
);
INSERT INTO sync_estado (id) VALUES (1);

-- Cola de lo que la estación hizo y falta subir. Cada fila se escribe en la misma transacción
-- que el cambio que representa. Nunca se borra: ni lo aplicado, ni los errores (E-16).
CREATE TABLE sync_outbox (
  secuencia              INTEGER PRIMARY KEY AUTOINCREMENT,   -- orden de envío
  id                     TEXT NOT NULL UNIQUE,                -- UUID que identifica la operación en el servidor
  tipo                   TEXT NOT NULL,
  idempotency_key        TEXT NOT NULL UNIQUE,
  staff_id               TEXT,
  ocurrida_en            TEXT NOT NULL,
  depende_de             TEXT NOT NULL DEFAULT '[]',          -- JSON: ids de otras operaciones
  payload                TEXT NOT NULL,                       -- JSON
  -- pendiente | enviando | aplicada | pendiente_revision | error | retenida
  estado                 TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente','enviando','aplicada','pendiente_revision','error','retenida')),
  intentos               INTEGER NOT NULL DEFAULT 0,
  ultimo_error_codigo    TEXT,
  ultimo_error_mensaje   TEXT,
  resultado              TEXT,                                -- JSON con la respuesta del servidor
  creada_en              TEXT NOT NULL,
  resuelta_en            TEXT
);
CREATE INDEX ix_outbox_estado ON sync_outbox(estado, secuencia);

CREATE TRIGGER sync_outbox_sin_delete
BEFORE DELETE ON sync_outbox
BEGIN
  SELECT RAISE(ABORT, 'La cola de sincronización no se borra');
END;
