-- =====================================================================
-- 062 · Catálogo de las clases que ofrece el gimnasio (Zumba, Spinning...)
-- =====================================================================
-- Idempotente. El catálogo solo sugiere datos al programar: cada sesión sigue guardando
-- su nombre y su cupo en platform.clases, así que editar el catálogo no cambia lo agendado.
-- =====================================================================

CREATE TABLE IF NOT EXISTS platform.catalogo_clases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id       uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  nombre            text        NOT NULL,
  descripcion       text,
  cupo_sugerido     integer     NOT NULL CHECK (cupo_sugerido > 0),
  duracion_minutos  integer     NOT NULL DEFAULT 60 CHECK (duracion_minutos > 0),
  activo            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_catalogo_clases_nombre
  ON platform.catalogo_clases(gimnasio_id, lower(nombre));

ALTER TABLE platform.catalogo_clases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalogo_clases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.catalogo_clases;
CREATE POLICY tenant_isolation ON platform.catalogo_clases
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.catalogo_clases TO gymos_platform;
