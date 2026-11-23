-- Nota opcional en cada cobro de la estación (ventas y pagos de membresía): lo que anota quien cobra,
-- p. ej. "paga el resto mañana" o "transferencia a nombre de la mamá". Idempotente.
ALTER TABLE platform.ventas ADD COLUMN IF NOT EXISTS nota text;
ALTER TABLE platform.pagos_membresia ADD COLUMN IF NOT EXISTS nota text;
