-- =====================================================================
-- 075 · Salud y contacto de emergencia del deportista (22-nov-2026)
-- =====================================================================
-- Idempotente. Opcional en el registro: grupo sanguíneo, condiciones médicas (alergias, enfermedades,
-- medicamentos, lesiones) y a quién llamar en una emergencia. Las condiciones médicas son un dato
-- sensible (Ley 1581, art. 5): se piden solo con el consentimiento del registro y nunca son obligatorias.
--
-- Columna nueva: platform.deportistas.salud (jsonb):
--   { grupo_sanguineo, condiciones, contacto_emergencia_nombre, contacto_emergencia_telefono }
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/075_salud_deportista.sql
-- =====================================================================

BEGIN;

ALTER TABLE platform.deportistas ADD COLUMN IF NOT EXISTS salud jsonb;

COMMIT;
