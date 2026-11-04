-- =====================================================================
-- 042 · Super-Admin: cerrar todas las sesiones de un usuario interno
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d <base> < infra/db/migrations/042_sa_sesiones_desde.sql
--
-- El SA usa tokens JWT sin estado: para "cerrar todas las sesiones" (SA-RF-00.2 CA3) se guarda desde
-- cuándo valen. Un token emitido antes de `sesiones_desde` se rechaza con 401.
-- =====================================================================

BEGIN;

ALTER TABLE superadmin.usuarios_internos
  ADD COLUMN IF NOT EXISTS sesiones_desde timestamptz;

COMMIT;
