-- GymDesk Escritorio · esquema local · fase 2 (ingreso sin red)

-- El servidor elige la membresía por vencimiento y, si empatan, por fecha de creación.
-- La estación necesita esa fecha para elegir la misma.
ALTER TABLE membresias ADD COLUMN created_at TEXT;

CREATE TABLE congelamientos (
  id            TEXT PRIMARY KEY,
  membresia_id  TEXT NOT NULL,
  fecha_inicio  TEXT NOT NULL,              -- AAAA-MM-DD
  fecha_fin     TEXT                        -- NULL = sigue congelada
);
CREATE INDEX ix_congelamientos_membresia ON congelamientos(membresia_id);

-- Ventas con pase de día. Dejan entrar el día en que se pagaron (día de Bogotá de created_at).
CREATE TABLE pases_dia (
  id             TEXT PRIMARY KEY,          -- id de la venta
  deportista_id  TEXT NOT NULL,
  created_at     TEXT NOT NULL,             -- instante UTC
  anulada        INTEGER NOT NULL
);
CREATE INDEX ix_pases_dia_deportista ON pases_dia(deportista_id);

-- Cada intento de ingreso y cada cortesía que registró esta estación. El id es el de su operación
-- en sync_outbox: se escriben juntos, en la misma transacción. No se borra.
CREATE TABLE ingresos (
  id                 TEXT PRIMARY KEY,
  tipo               TEXT NOT NULL CHECK (tipo IN ('ingreso','cortesia')),
  deportista_id      TEXT,
  deportista_nombre  TEXT,                  -- como se llamaba al entrar
  metodo             TEXT NOT NULL CHECK (metodo IN ('manual','huella')),
  resultado          TEXT NOT NULL CHECK (resultado IN ('abrio','alerta_mora','negado')),
  estado             TEXT,                  -- estado calculado del cliente en ese momento
  con_pase_dia       INTEGER NOT NULL DEFAULT 0 CHECK (con_pase_dia IN (0,1)),
  mensaje            TEXT NOT NULL,
  motivo_cortesia    TEXT,
  staff_id           TEXT NOT NULL,
  ocurrido_en        TEXT NOT NULL,         -- instante UTC
  fecha_negocio      TEXT NOT NULL,         -- día de Bogotá
  CHECK ((tipo = 'cortesia' AND deportista_id IS NULL AND motivo_cortesia IS NOT NULL)
      OR (tipo = 'ingreso' AND deportista_id IS NOT NULL))
);
CREATE INDEX ix_ingresos_dia ON ingresos(fecha_negocio, ocurrido_en DESC);
CREATE INDEX ix_ingresos_deportista ON ingresos(deportista_id, ocurrido_en DESC);

CREATE TRIGGER ingresos_sin_delete
BEFORE DELETE ON ingresos
BEGIN
  SELECT RAISE(ABORT, 'Los ingresos registrados no se borran');
END;

-- Esta versión necesita datos que la anterior no descargaba: la próxima sincronización vuelve a
-- traer todo. Lo repetido se reemplaza por id; no se pierde nada local.
UPDATE sync_estado SET cursor = NULL WHERE id = 1;
