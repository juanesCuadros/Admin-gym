-- =====================================================================
-- 030 · Carril 3 (Super-Admin) · Regla del ancla y estado calculado en el panel
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_c3 < infra/db/migrations/030_sa_corte_y_estado.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Regla del ancla en la fecha de corte (requisitos SA §3, SA-RF-17)
-- ---------------------------------------------------------------------
-- true = el pago se registró con el gimnasio en prueba, suspendido o bloqueado (d >= 4):
-- su fecha_pago es la nueva ancla. Se decide al registrar el pago y no cambia después, para que
-- anular otros pagos no mueva el ancla (CA3) y anular el propio pago deje el corte en el ancla (CA6).
ALTER TABLE superadmin.pagos
  ADD COLUMN IF NOT EXISTS fija_ancla boolean NOT NULL DEFAULT false;

COMMIT;
