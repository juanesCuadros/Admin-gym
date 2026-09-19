-- =====================================================================
-- 002 · platform.tenant: columnas que el módulo MyGymOS (RF-45..48) ya
-- consultaba y no existían en el esquema canónico.
-- =====================================================================
-- Sin estas columnas GET /my-gym/info, PUT /my-gym/info, PATCH /my-gym/parametros,
-- PUT /my-gym/metodos-pago y PATCH /my-gym/branding fallan con 500
-- ("column ... does not exist"). Idempotente.
--
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_db < infra/db/migrations/002_tenant_info_general.sql
-- =====================================================================

BEGIN;

ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS ciudad    text,
  ADD COLUMN IF NOT EXISTS telefono  text,
  ADD COLUMN IF NOT EXISTS correo    citext,
  ADD COLUMN IF NOT EXISTS redes     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  -- Concurrencia optimista (OCC) en las mutaciones de configuración
  ADD COLUMN IF NOT EXISTS version   integer NOT NULL DEFAULT 1;

COMMIT;
