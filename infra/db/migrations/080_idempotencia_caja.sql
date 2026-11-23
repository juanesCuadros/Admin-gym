-- =====================================================================
-- 080 · Clave de idempotencia en abrir y cerrar turno, egresos y anulaciones
-- =====================================================================
-- Idempotente. Mismo mecanismo que ventas y pagos de membresía: el header
-- X-Idempotency-Key se guarda en la fila que crea o cambia la operación y es
-- único por gimnasio. Un doble envío con la misma clave devuelve el resultado
-- original y no duplica nada.
--
-- Las columnas son opcionales: los registros anteriores no tienen clave y el
-- egreso que deja un gasto en efectivo usa la clave del gasto (platform.gastos).
-- =====================================================================

BEGIN;

ALTER TABLE platform.turnos_caja
  ADD COLUMN IF NOT EXISTS idempotency_key_apertura text,
  ADD COLUMN IF NOT EXISTS idempotency_key_cierre   text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_caja_idem_apertura
  ON platform.turnos_caja(gimnasio_id, idempotency_key_apertura)
  WHERE idempotency_key_apertura IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_turnos_caja_idem_cierre
  ON platform.turnos_caja(gimnasio_id, idempotency_key_cierre)
  WHERE idempotency_key_cierre IS NOT NULL;

ALTER TABLE platform.egresos_caja
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_egresos_caja_idem
  ON platform.egresos_caja(gimnasio_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE platform.ventas
  ADD COLUMN IF NOT EXISTS idempotency_key_anulacion text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ventas_idem_anulacion
  ON platform.ventas(gimnasio_id, idempotency_key_anulacion)
  WHERE idempotency_key_anulacion IS NOT NULL;

ALTER TABLE platform.pagos_membresia
  ADD COLUMN IF NOT EXISTS idempotency_key_anulacion text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pagos_membresia_idem_anulacion
  ON platform.pagos_membresia(gimnasio_id, idempotency_key_anulacion)
  WHERE idempotency_key_anulacion IS NOT NULL;

COMMIT;
