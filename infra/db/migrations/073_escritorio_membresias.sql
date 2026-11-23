-- =====================================================================
-- 073 · GymDesk Escritorio: venta y renovación de membresías sin red (fase 3B, parte 1)
-- =====================================================================
-- Idempotente. Decisión de Juan del 22-nov-2026 (E-36): sin red se renueva una membresía existente o
-- se vende una nueva a un cliente ya registrado. El pago queda en el turno de la estación; la fecha la
-- recalcula el servidor y, si no coincide con la de la estación, manda la del servidor y queda por revisar.
--
-- TABLAS COMPARTIDAS QUE TOCA:
--   platform.pagos_membresia  columna recibido_en (opcional): cuándo llegó al servidor un pago hecho en
--                             una estación. Los de la web la dejan en NULL.
-- No cambia nada de lo que ya se registró desde la web.
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/073_escritorio_membresias.sql
-- =====================================================================

BEGIN;

ALTER TABLE platform.pagos_membresia ADD COLUMN IF NOT EXISTS recibido_en timestamptz;

COMMIT;
