-- GymDesk Escritorio · esquema local · fase 0 (base)
-- Instantes en texto ISO-8601 UTC. Dinero, cuando llegue, en COP enteros.

-- La estación: una sola fila. gimnasio_id y subdominio se llenan al activarla (fase 1).
CREATE TABLE estacion (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  estacion_id      TEXT NOT NULL,
  gimnasio_id      TEXT,
  subdominio       TEXT,
  gimnasio_nombre  TEXT,
  activada_en      TEXT,
  creada_en        TEXT NOT NULL
);

-- Personal que puede usar esta estación. Lo llena la sincronización (fase 1).
-- hash_password y hash_pin son verificadores Argon2id propios de esta estación:
-- nunca se descargan del servidor ni se suben.
CREATE TABLE staff_local (
  id              TEXT PRIMARY KEY,
  nombre          TEXT NOT NULL,
  correo          TEXT NOT NULL UNIQUE,
  rol             TEXT NOT NULL CHECK (rol IN ('jefe','recepcionista','entrenador')),
  activo          INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  hash_password   TEXT,
  hash_pin        TEXT,
  pin_creado_en   TEXT,
  actualizado_en  TEXT NOT NULL
);

-- Intentos de ingreso, para el bloqueo de 15 min tras 5 fallos (P-16).
-- identificador = correo en minúsculas (contraseña) o id del staff (PIN).
CREATE TABLE intentos_ingreso (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  identificador  TEXT NOT NULL,
  exito          INTEGER NOT NULL CHECK (exito IN (0,1)),
  ts_utc         TEXT NOT NULL
);
CREATE INDEX ix_intentos_ident ON intentos_ingreso(identificador, id DESC);

-- Auditoría local: solo inserción y con cadena de hash.
CREATE TABLE auditoria_local (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc        TEXT NOT NULL,
  actor_id      TEXT,
  actor_nombre  TEXT,
  accion        TEXT NOT NULL,
  entidad       TEXT NOT NULL,
  entidad_id    TEXT,
  detalle       TEXT NOT NULL,
  hash_previo   TEXT NOT NULL,
  hash          TEXT NOT NULL
);

CREATE TRIGGER auditoria_local_sin_update
BEFORE UPDATE ON auditoria_local
BEGIN
  SELECT RAISE(ABORT, 'La auditoría no se puede modificar');
END;

CREATE TRIGGER auditoria_local_sin_delete
BEFORE DELETE ON auditoria_local
BEGIN
  SELECT RAISE(ABORT, 'La auditoría no se puede borrar');
END;
