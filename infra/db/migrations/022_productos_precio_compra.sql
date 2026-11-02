-- =====================================================================
-- 022 · Precio de compra en productos para cálculo de margen y reportes
-- =====================================================================
-- Idempotente. Agrega `precio_compra` a `platform.productos` para capturar
-- el costo unitario de adquisición junto con el precio de venta (`precio`).
-- =====================================================================

BEGIN;

ALTER TABLE platform.productos
  ADD COLUMN IF NOT EXISTS precio_compra numeric(12,2) NOT NULL DEFAULT 0
  CHECK (precio_compra >= 0);

COMMIT;
