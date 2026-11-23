-- GymDesk Escritorio · esquema local · fase 3B, parte 1 (vender y renovar membresías sin red)
--
-- Cada cobro usa el id de su operación en sync_outbox y se escribe en la misma transacción que ella.
-- Al cobrar, la membresía local cambia de inmediato (renovación) o se crea (venta), para que el cliente
-- pueda entrar de una vez. Mientras la operación no haya llegado al servidor, la descarga no deshace ese
-- cambio: se vuelve a aplicar después de cada página (sync/descarga.rs). Nada de esto se borra ni se edita.

-- Precio al que se vendió el plan de la membresía: es el precio de lista de una renovación (igual que la web).
ALTER TABLE membresias ADD COLUMN plan_precio_vendido INTEGER;

CREATE TABLE caja_pagos_membresia (
  id                          TEXT PRIMARY KEY,
  tipo                        TEXT NOT NULL CHECK (tipo IN ('venta','renovacion')),
  turno_id                    TEXT NOT NULL REFERENCES caja_turnos(id),
  membresia_id                TEXT NOT NULL,
  deportista_id               TEXT NOT NULL,
  deportista_nombre           TEXT NOT NULL,
  plan_id                     TEXT NOT NULL,
  plan_nombre                 TEXT NOT NULL,
  dias                        INTEGER NOT NULL CHECK (dias > 0),
  fecha_inicio                TEXT,              -- venta: AAAA-MM-DD
  fecha_vencimiento_anterior  TEXT,              -- renovación: AAAA-MM-DD
  fecha_vencimiento_nueva     TEXT NOT NULL,     -- AAAA-MM-DD
  precio_lista                INTEGER NOT NULL CHECK (precio_lista > 0),
  precio_cobrado              INTEGER NOT NULL CHECK (precio_cobrado > 0),
  motivo_descuento            TEXT,
  tipo_medio                  TEXT NOT NULL CHECK (tipo_medio IN ('efectivo','otro','mixto')),
  metodo                      TEXT NOT NULL,
  valor_recibido              INTEGER,
  cambio                      INTEGER,
  staff_id                    TEXT NOT NULL,
  ocurrida_en                 TEXT NOT NULL,
  fecha_negocio               TEXT NOT NULL,
  CHECK ((tipo = 'venta' AND fecha_inicio IS NOT NULL) OR (tipo = 'renovacion' AND fecha_vencimiento_anterior IS NOT NULL))
);
CREATE INDEX ix_caja_pagos_memb_turno ON caja_pagos_membresia(turno_id, ocurrida_en);
CREATE INDEX ix_caja_pagos_memb_membresia ON caja_pagos_membresia(membresia_id, ocurrida_en);

CREATE TABLE caja_pago_membresia_medios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pago_id     TEXT NOT NULL REFERENCES caja_pagos_membresia(id),
  metodo      TEXT NOT NULL,
  tipo_medio  TEXT NOT NULL CHECK (tipo_medio IN ('efectivo','otro')),
  monto       INTEGER NOT NULL CHECK (monto > 0)
);
CREATE INDEX ix_caja_pago_memb_medios ON caja_pago_membresia_medios(pago_id);

CREATE TRIGGER caja_pagos_memb_sin_delete BEFORE DELETE ON caja_pagos_membresia
BEGIN SELECT RAISE(ABORT, 'Los pagos de membresía no se borran'); END;
CREATE TRIGGER caja_pagos_memb_sin_update BEFORE UPDATE ON caja_pagos_membresia
BEGIN SELECT RAISE(ABORT, 'Los pagos de membresía no se modifican'); END;
CREATE TRIGGER caja_pago_memb_medios_sin_delete BEFORE DELETE ON caja_pago_membresia_medios
BEGIN SELECT RAISE(ABORT, 'El reparto de un pago no se borra'); END;

-- Esta versión necesita el precio vendido de cada membresía: la próxima sincronización vuelve a traer todo.
UPDATE sync_estado SET cursor = NULL WHERE id = 1;
