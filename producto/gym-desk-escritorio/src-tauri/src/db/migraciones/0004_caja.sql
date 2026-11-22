-- GymDesk Escritorio · esquema local · fase 3A (caja sin red: turno, mostrador y egresos)
--
-- Los montos son pesos colombianos enteros. Cada turno, venta y egreso usa el id de su operación en
-- sync_outbox y se escribe en la misma transacción que ella: el servidor guarda el mismo id.
-- Nada de esto se borra ni se edita después: un turno cerrado es inmutable (P-11).

-- Precio configurado de los pases (NULL = se escribe al cobrar).
ALTER TABLE gimnasio ADD COLUMN precio_pase_dia INTEGER;
ALTER TABLE gimnasio ADD COLUMN precio_pase_clase INTEGER;

CREATE TABLE caja_turnos (
  id                       TEXT PRIMARY KEY,
  staff_id                 TEXT NOT NULL,             -- quien abrió
  base_inicial             INTEGER NOT NULL CHECK (base_inicial >= 0),
  abierto_en               TEXT NOT NULL,             -- instante UTC
  fecha_negocio            TEXT NOT NULL,             -- día de Bogotá en que se abrió
  -- Se abrió sin poder confirmar con el servidor que no hubiera otro turno abierto (sin red).
  sin_confirmar            INTEGER NOT NULL DEFAULT 0 CHECK (sin_confirmar IN (0,1)),
  estado                   TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  cerrado_en               TEXT,
  cerrado_por              TEXT,
  efectivo_contado         INTEGER,
  total_esperado_efectivo  INTEGER,
  diferencia               INTEGER,
  nota_cierre              TEXT,
  CHECK ((estado = 'abierto' AND cerrado_en IS NULL) OR (estado = 'cerrado' AND cerrado_en IS NOT NULL
         AND efectivo_contado IS NOT NULL AND total_esperado_efectivo IS NOT NULL))
);
-- Un solo turno abierto en la estación.
CREATE UNIQUE INDEX ux_caja_turno_abierto ON caja_turnos(estado) WHERE estado = 'abierto';
CREATE INDEX ix_caja_turnos_dia ON caja_turnos(fecha_negocio, abierto_en);

CREATE TABLE caja_ventas (
  id                 TEXT PRIMARY KEY,
  turno_id           TEXT NOT NULL REFERENCES caja_turnos(id),
  deportista_id      TEXT,
  deportista_nombre  TEXT,
  total              INTEGER NOT NULL CHECK (total >= 0),
  tipo_medio         TEXT NOT NULL CHECK (tipo_medio IN ('efectivo','otro','mixto')),
  metodo             TEXT NOT NULL,
  valor_recibido     INTEGER,
  cambio             INTEGER,
  staff_id           TEXT NOT NULL,
  ocurrida_en        TEXT NOT NULL,
  fecha_negocio      TEXT NOT NULL
);
CREATE INDEX ix_caja_ventas_turno ON caja_ventas(turno_id, ocurrida_en);

CREATE TABLE caja_venta_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id          TEXT NOT NULL REFERENCES caja_ventas(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('producto','pase_dia','pase_clase')),
  producto_id       TEXT,
  descripcion       TEXT NOT NULL,
  cantidad          INTEGER NOT NULL CHECK (cantidad > 0),
  precio_lista      INTEGER NOT NULL CHECK (precio_lista >= 0),
  precio_cobrado    INTEGER NOT NULL CHECK (precio_cobrado >= 0),
  subtotal          INTEGER NOT NULL CHECK (subtotal >= 0),
  motivo_descuento  TEXT,
  CHECK (tipo <> 'producto' OR producto_id IS NOT NULL)
);
CREATE INDEX ix_caja_items_venta ON caja_venta_items(venta_id);
CREATE INDEX ix_caja_items_producto ON caja_venta_items(producto_id) WHERE producto_id IS NOT NULL;

-- Reparto de un pago mixto.
CREATE TABLE caja_venta_medios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id    TEXT NOT NULL REFERENCES caja_ventas(id),
  metodo      TEXT NOT NULL,
  tipo_medio  TEXT NOT NULL CHECK (tipo_medio IN ('efectivo','otro')),
  monto       INTEGER NOT NULL CHECK (monto > 0)
);
CREATE INDEX ix_caja_medios_venta ON caja_venta_medios(venta_id);

CREATE TABLE caja_egresos (
  id             TEXT PRIMARY KEY,
  turno_id       TEXT NOT NULL REFERENCES caja_turnos(id),
  monto          INTEGER NOT NULL CHECK (monto > 0),
  motivo         TEXT NOT NULL,
  staff_id       TEXT NOT NULL,
  ocurrido_en    TEXT NOT NULL,
  fecha_negocio  TEXT NOT NULL
);
CREATE INDEX ix_caja_egresos_turno ON caja_egresos(turno_id, ocurrido_en);

CREATE TRIGGER caja_turnos_sin_delete BEFORE DELETE ON caja_turnos
BEGIN SELECT RAISE(ABORT, 'Los turnos de caja no se borran'); END;
-- Un turno cerrado no cambia.
CREATE TRIGGER caja_turnos_cerrado_inmutable BEFORE UPDATE ON caja_turnos WHEN OLD.estado = 'cerrado'
BEGIN SELECT RAISE(ABORT, 'Un turno cerrado no se modifica'); END;
CREATE TRIGGER caja_ventas_sin_delete BEFORE DELETE ON caja_ventas
BEGIN SELECT RAISE(ABORT, 'Las ventas no se borran'); END;
CREATE TRIGGER caja_ventas_sin_update BEFORE UPDATE ON caja_ventas
BEGIN SELECT RAISE(ABORT, 'Las ventas no se modifican'); END;
CREATE TRIGGER caja_items_sin_cambios BEFORE DELETE ON caja_venta_items
BEGIN SELECT RAISE(ABORT, 'Los ítems de una venta no se borran'); END;
CREATE TRIGGER caja_medios_sin_cambios BEFORE DELETE ON caja_venta_medios
BEGIN SELECT RAISE(ABORT, 'El reparto de un pago no se borra'); END;
CREATE TRIGGER caja_egresos_sin_delete BEFORE DELETE ON caja_egresos
BEGIN SELECT RAISE(ABORT, 'Los egresos no se borran'); END;

-- Esta versión necesita los precios de los pases: la próxima sincronización vuelve a traer todo.
UPDATE sync_estado SET cursor = NULL WHERE id = 1;
