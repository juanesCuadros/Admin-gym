#!/bin/sh
# infra/db/02_arranque.sh — corre una sola vez, después de 01_schema.sql
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
-- Contraseñas de los roles de aplicación (vienen del .env)
ALTER ROLE gymos_superadmin PASSWORD '${GYMOS_SUPERADMIN_PASSWORD}';
ALTER ROLE gymos_platform  PASSWORD '${GYMOS_PLATFORM_PASSWORD}';

-- El bootstrap de super-admin-api inserta rol 'superadmin'; el CHECK original solo admite admin/soporte
ALTER TABLE superadmin.usuarios_internos DROP CONSTRAINT usuarios_internos_rol_check;
ALTER TABLE superadmin.usuarios_internos ADD CONSTRAINT usuarios_internos_rol_check
  CHECK (rol IN ('superadmin','admin','soporte'));

-- super-admin-api la consulta en cada request autenticado; no existía en ningún esquema
CREATE TABLE superadmin.tokens_invalidos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  usuario_id   uuid,
  expira_en    timestamptz NOT NULL,
  revocado_en  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON superadmin.tokens_invalidos TO gymos_superadmin;

-- El provisioning crea el jefe inicial en platform.staff
GRANT SELECT, INSERT, UPDATE ON platform.staff TO gymos_superadmin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO gymos_superadmin;

-- RLS: el WITH CHECK de tenant_isolation exige gimnasio_id = current_gimnasio_id(),
-- y super-admin-api nunca fija app.gimnasio_id → el INSERT en platform.staff falla.
-- Política POR ROL (no se toca la de los tenants): el superadmin ve y escribe todo
-- en las tablas que le corresponden, y nada más.
CREATE POLICY superadmin_provisioning ON platform.staff
  FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true);
CREATE POLICY superadmin_catalogo ON platform.ejercicios
  FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true);
EOF
