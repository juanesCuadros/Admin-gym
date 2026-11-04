-- =====================================================================
-- 061 · Nota del Jefe al revisar un turno con descuadre (GW-RF-10 CA2)
-- =====================================================================
-- Idempotente. El estado y quién revisó ya existían en platform.turnos_caja; faltaba la nota.
-- El arqueo del turno sigue inmutable: revisar no cambia ningún valor.
-- =====================================================================

ALTER TABLE platform.turnos_caja
  ADD COLUMN IF NOT EXISTS nota_revision text;
