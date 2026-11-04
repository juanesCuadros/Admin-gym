-- =====================================================================
-- 063 · Encargado de la sede e imágenes de la landing del gimnasio
-- =====================================================================
-- Idempotente. Las imágenes van en la base: sobreviven a recrear contenedores y entran en
-- los respaldos sin montar volúmenes nuevos. Los textos de la landing viven en tenant.branding.
-- =====================================================================

ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS encargado_nombre text;

CREATE TABLE IF NOT EXISTS platform.gym_imagenes (
  gimnasio_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  tipo         text        NOT NULL CHECK (tipo IN ('logo','banner')),
  contenido    bytea       NOT NULL,
  media_type   text        NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gimnasio_id, tipo)
);

ALTER TABLE platform.gym_imagenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.gym_imagenes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.gym_imagenes;
CREATE POLICY tenant_isolation ON platform.gym_imagenes
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.gym_imagenes TO gymos_platform;
