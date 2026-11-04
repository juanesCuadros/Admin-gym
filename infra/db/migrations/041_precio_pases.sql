-- =====================================================================
-- 041 · Precio del pase de día y del pase de clase como parámetro del gimnasio
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d <base> < infra/db/migrations/041_precio_pases.sql
--
-- COP enteros. NULL = el gimnasio no lo ha configurado: el punto de venta sigue pidiendo el precio a mano.
-- Configurado, es el precio de lista de la venta (igual que platform.productos.precio); cobrar menos pasa
-- por la regla de descuentos (GW-RF-53).
-- =====================================================================

BEGIN;

ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS precio_pase_dia   numeric(12,0),
  ADD COLUMN IF NOT EXISTS precio_pase_clase numeric(12,0);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_precio_pases_rango') THEN
    ALTER TABLE platform.tenant ADD CONSTRAINT tenant_precio_pases_rango CHECK (
      (precio_pase_dia IS NULL OR precio_pase_dia >= 0)
      AND (precio_pase_clase IS NULL OR precio_pase_clase >= 0)
    );
  END IF;
END$$;

COMMIT;
