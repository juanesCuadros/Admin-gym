-- =====================================================================
-- 065 · Turno de trabajo: entrada y salida del personal, separado de la caja
-- =====================================================================
-- Idempotente. Decisión de Juan del 4-nov-2026: una sola caja por gimnasio, y varias personas
-- pueden tener su turno de trabajo abierto a la vez. Solo registra y calcula las horas: no toca dinero.
-- =====================================================================

CREATE TABLE IF NOT EXISTS platform.turnos_trabajo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  staff_id     uuid        NOT NULL REFERENCES platform.staff(id) ON DELETE CASCADE,
  entrada_en   timestamptz NOT NULL DEFAULT now(),
  salida_en    timestamptz,
  -- Solo se llena si el Jefe cerró un turno que la persona olvidó cerrar.
  cerrado_por  uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  motivo_cierre text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT turno_trabajo_fechas CHECK (salida_en IS NULL OR salida_en >= entrada_en)
);

-- Cada persona tiene como máximo un turno abierto; entre personas no hay límite.
CREATE UNIQUE INDEX IF NOT EXISTS ux_turno_trabajo_abierto
  ON platform.turnos_trabajo(staff_id) WHERE salida_en IS NULL;
CREATE INDEX IF NOT EXISTS ix_turno_trabajo_gym ON platform.turnos_trabajo(gimnasio_id, entrada_en DESC);

ALTER TABLE platform.turnos_trabajo ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.turnos_trabajo FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.turnos_trabajo;
CREATE POLICY tenant_isolation ON platform.turnos_trabajo
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.turnos_trabajo TO gymos_platform;
