-- =====================================================================
-- 020 · Carril 2: Clientes, Ingreso y Salidas, Configuración y Personal
-- =====================================================================
-- Idempotente. Aplica cambios requeridos para los contratos 2.2, 2.3 y 2.4:
-- 1. Salidas en platform.checkins (GW-RF-54)
-- 2. Tipo de documento, acudiente y consentimiento en platform.deportistas (GW-RF-17, 19)
-- 3. Origen en platform.membresias para migración/carga inicial (GW-RF-55)
-- =====================================================================

BEGIN;

-- 1. Salidas en platform.checkins
ALTER TABLE platform.checkins
  ADD COLUMN IF NOT EXISTS salida_ts timestamptz,
  ADD COLUMN IF NOT EXISTS salida_registrado_por uuid REFERENCES platform.staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_checkin_adentro
  ON platform.checkins(gimnasio_id, ts_utc)
  WHERE salida_ts IS NULL AND resultado IN ('abrio', 'alerta_mora') AND tipo = 'ingreso';

-- 2. Tipo de documento, acudiente y consentimiento en platform.deportistas
ALTER TABLE platform.deportistas
  ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'CC',
  ADD COLUMN IF NOT EXISTS acudiente jsonb,
  ADD COLUMN IF NOT EXISTS consentimiento_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS consentimiento_registrado_por uuid REFERENCES platform.staff(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tipo_documento') THEN
    ALTER TABLE platform.deportistas ADD CONSTRAINT chk_tipo_documento
      CHECK (tipo_documento IN ('CC', 'TI', 'CE', 'PAS', 'PPT', 'RC'));
  END IF;
END$$;

DROP INDEX IF EXISTS platform.ux_dep_documento_gym;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dep_documento_gym
  ON platform.deportistas(gimnasio_id, tipo_documento, documento) WHERE deleted_at IS NULL;

-- 3. Origen en platform.membresias para carga inicial / migración
ALTER TABLE platform.membresias
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'venta';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_membresia_origen') THEN
    ALTER TABLE platform.membresias ADD CONSTRAINT chk_membresia_origen
      CHECK (origen IN ('venta', 'migracion'));
  END IF;
END$$;

COMMIT;
