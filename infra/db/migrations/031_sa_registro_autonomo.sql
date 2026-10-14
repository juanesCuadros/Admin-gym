-- =====================================================================
-- 031 · Carril 3 (Super-Admin) · Registro autónomo con prueba gratis (SA-RF-34)
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_c3 < infra/db/migrations/031_sa_registro_autonomo.sql
-- =====================================================================

BEGIN;

-- Cada solicitud de registro desde gymdeskcolombia.com. El gimnasio se crea solo cuando el Jefe
-- confirma el correo con el enlace (token de un solo uso, 24 h). El token se guarda como hash.
CREATE TABLE IF NOT EXISTS superadmin.registros_autonomos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_gimnasio       text        NOT NULL CHECK (length(btrim(nombre_gimnasio)) >= 2),
  ciudad                text        NOT NULL,
  jefe_nombre           text        NOT NULL,
  jefe_correo           citext      NOT NULL,
  telefono              text        NOT NULL,
  telefono_normalizado  text        NOT NULL CHECK (telefono_normalizado ~ '^[0-9]{7,15}$'),
  subdominio_sugerido   text        NOT NULL,
  token_hash            text        NOT NULL UNIQUE,
  expira_en             timestamptz NOT NULL,
  usado_en              timestamptz,
  gimnasio_id           uuid        REFERENCES superadmin.gimnasios(id) ON DELETE SET NULL,
  acepta_terminos_en    timestamptz NOT NULL,
  ip                    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registro_vigencia CHECK (expira_en > created_at),
  CONSTRAINT registro_uso_coherente CHECK (usado_en IS NOT NULL OR gimnasio_id IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_registro_correo   ON superadmin.registros_autonomos(jefe_correo);
CREATE INDEX IF NOT EXISTS ix_registro_telefono ON superadmin.registros_autonomos(telefono_normalizado);

-- Una prueba por correo y una por teléfono (SA-RF-34 "Abuso"): solo un registro confirmado por cada uno.
-- Sigue contando aunque el gimnasio se elimine después (gimnasio_id pasa a NULL, usado_en se conserva).
CREATE UNIQUE INDEX IF NOT EXISTS ux_registro_prueba_por_correo
  ON superadmin.registros_autonomos(jefe_correo) WHERE usado_en IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_registro_prueba_por_telefono
  ON superadmin.registros_autonomos(telefono_normalizado) WHERE usado_en IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON superadmin.registros_autonomos TO gymos_superadmin;

COMMIT;
