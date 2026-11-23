-- =====================================================================
-- 081 · Anular gastos (B1, 22-nov-2026)
-- =====================================================================
-- Idempotente.
--   · platform.gastos: marca de anulación (motivo, quién, cuándo) y su clave de idempotencia,
--     única por gimnasio (mismo mecanismo que ventas y pagos). Un gasto anulado no se borra.
--   · platform.reintegros_caja: el efectivo de un gasto anulado vuelve a la caja del turno abierto
--     (P-11: el turno cerrado no se toca). Suma al efectivo esperado del turno donde se registra.
-- =====================================================================

BEGIN;

ALTER TABLE platform.gastos
  ADD COLUMN IF NOT EXISTS anulado                    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_anulacion           text,
  ADD COLUMN IF NOT EXISTS anulado_por                uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulado_en                 timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key_anulacion  text;

ALTER TABLE platform.gastos DROP CONSTRAINT IF EXISTS gasto_anulacion_coherente;
ALTER TABLE platform.gastos ADD CONSTRAINT gasto_anulacion_coherente CHECK (
  (anulado = false AND motivo_anulacion IS NULL AND anulado_en IS NULL)
  OR (anulado = true AND motivo_anulacion IS NOT NULL AND anulado_en IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gastos_idem_anulacion
  ON platform.gastos(gimnasio_id, idempotency_key_anulacion)
  WHERE idempotency_key_anulacion IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.reintegros_caja (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id         uuid          NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  turno_id            uuid          NOT NULL REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  gasto_id            uuid          NOT NULL REFERENCES platform.gastos(id) ON DELETE RESTRICT,
  turno_original_id   uuid          REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  monto               numeric(12,2) NOT NULL CHECK (monto > 0),
  motivo              text          NOT NULL,
  registrado_por      uuid          REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (gasto_id)
);
CREATE INDEX IF NOT EXISTS ix_reintegros_turno ON platform.reintegros_caja(turno_id);

ALTER TABLE platform.reintegros_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.reintegros_caja FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.reintegros_caja;
CREATE POLICY tenant_isolation ON platform.reintegros_caja
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());
GRANT SELECT, INSERT ON platform.reintegros_caja TO gymos_platform;

COMMIT;
