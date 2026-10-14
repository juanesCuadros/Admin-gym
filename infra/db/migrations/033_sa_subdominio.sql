-- =====================================================================
-- 033 · Carril 3 (Super-Admin) · Reglas del subdominio (SA-RF-05)
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_c3 < infra/db/migrations/033_sa_subdominio.sql
-- CA2: de 3 a 63 caracteres (límite de etiqueta DNS, RFC 1035); antes el CHECK admitía 3–50.
-- CA3: palabras reservadas admin, www, api, app, mail (también en la base, no solo en la API).
-- =====================================================================

BEGIN;

ALTER TABLE superadmin.gimnasios DROP CONSTRAINT IF EXISTS gimnasios_subdominio_check;
ALTER TABLE superadmin.gimnasios DROP CONSTRAINT IF EXISTS gimnasios_subdominio_formato;
ALTER TABLE superadmin.gimnasios ADD CONSTRAINT gimnasios_subdominio_formato CHECK (
  subdominio ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$'
  AND subdominio NOT IN ('admin', 'www', 'api', 'app', 'mail')
);

COMMIT;
