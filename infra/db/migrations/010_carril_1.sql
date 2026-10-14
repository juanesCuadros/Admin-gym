-- =====================================================================
-- 010 · Carril 1: Caja, Membresías y Clases
-- =====================================================================
-- Idempotente. Aplica cambios de esquema para el Carril 1:
--   1. Turno único por gimnasio (GW-RF-08, Contrato 1.1)
--   2. Copia del plan en la venta (GW-RF-24 CA2)
--   3. Planes grupales y paquetes (GW-RF-52, Contrato 1.3)
--   4. Reversos de pagos de membresía en turno actual (GW-RF-16 CA3)
--   5. Descuentos y precio editable (GW-RF-53, Contrato 1.2)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Turno único por gimnasio (GW-RF-08, Contrato 1.1)
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS platform.ux_turno_abierto_por_staff;

CREATE UNIQUE INDEX IF NOT EXISTS ux_turno_abierto_por_gym
  ON platform.turnos_caja(gimnasio_id) WHERE estado = 'abierto';

ALTER TABLE platform.turnos_caja
  ADD COLUMN IF NOT EXISTS cerrado_por uuid REFERENCES platform.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nota_cierre text;

-- ---------------------------------------------------------------------
-- 2. Copia del plan en la venta (GW-RF-24 CA2)
-- ---------------------------------------------------------------------
ALTER TABLE platform.membresias
  ADD COLUMN IF NOT EXISTS plan_precio_vendido numeric(12,2),
  ADD COLUMN IF NOT EXISTS plan_duracion_dias_vendida integer;

-- ---------------------------------------------------------------------
-- 3. Planes grupales y paquetes (GW-RF-52, Contrato 1.3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.paquetes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  plan_id      uuid NOT NULL REFERENCES platform.planes(id) ON DELETE RESTRICT,
  titular_id   uuid NOT NULL REFERENCES platform.deportistas(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_paquetes_gym ON platform.paquetes(gimnasio_id);

ALTER TABLE platform.membresias
  ADD COLUMN IF NOT EXISTS paquete_id uuid REFERENCES platform.paquetes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS precio_asignado numeric(12,2);

CREATE INDEX IF NOT EXISTS ix_memb_paquete ON platform.membresias(paquete_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.paquetes TO gymos_platform;

-- ---------------------------------------------------------------------
-- 4. Pagos de membresía con soporte para paquetes y descuentos (GW-RF-15, 16, 52, 53)
-- ---------------------------------------------------------------------
ALTER TABLE platform.pagos_membresia
  ALTER COLUMN membresia_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS paquete_id uuid REFERENCES platform.paquetes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS precio_lista numeric(12,2),
  ADD COLUMN IF NOT EXISTS precio_cobrado numeric(12,2),
  ADD COLUMN IF NOT EXISTS descuento_pct numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_descuento text;

CREATE INDEX IF NOT EXISTS ix_pagomemb_paquete ON platform.pagos_membresia(paquete_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagomemb_destino') THEN
    ALTER TABLE platform.pagos_membresia ADD CONSTRAINT pagomemb_destino CHECK (
      (membresia_id IS NOT NULL AND paquete_id IS NULL)
      OR (membresia_id IS NULL AND paquete_id IS NOT NULL)
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 5. Devoluciones: soporte para anulación de pagos de membresía (GW-RF-16 CA3)
-- ---------------------------------------------------------------------
ALTER TABLE platform.devoluciones
  ALTER COLUMN venta_original_id DROP NOT NULL,
  ALTER COLUMN turno_venta_original_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS pago_membresia_id uuid REFERENCES platform.pagos_membresia(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS turno_pago_original_id uuid REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_dev_pagomemb ON platform.devoluciones(pago_membresia_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dev_origen_coherente') THEN
    ALTER TABLE platform.devoluciones ADD CONSTRAINT dev_origen_coherente CHECK (
      (venta_original_id IS NOT NULL AND turno_venta_original_id IS NOT NULL AND pago_membresia_id IS NULL)
      OR (pago_membresia_id IS NOT NULL AND turno_pago_original_id IS NOT NULL AND venta_original_id IS NULL)
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 6. Descuentos y precio editable en venta de productos/ítems (GW-RF-53)
-- ---------------------------------------------------------------------
ALTER TABLE platform.venta_items
  ADD COLUMN IF NOT EXISTS precio_lista numeric(12,2),
  ADD COLUMN IF NOT EXISTS precio_cobrado numeric(12,2),
  ADD COLUMN IF NOT EXISTS descuento_pct numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_descuento text;

COMMIT;
