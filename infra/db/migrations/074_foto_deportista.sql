-- =====================================================================
-- 074 · Foto del deportista (decisión E-41 del 22-nov-2026)
-- =====================================================================
-- Idempotente. La estación de escritorio toma la foto con la cámara al registrar un cliente (opcional).
-- Se guarda en la base, como las imágenes de la landing (gym_imagenes), pero NO es pública: es un dato
-- personal (Ley 1581) y solo la ve el personal con permiso de leer deportistas.
--
-- TABLA NUEVA: platform.deportista_fotos (una foto por deportista, se reemplaza al tomar otra).
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/074_foto_deportista.sql
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platform.deportista_fotos (
  deportista_id  uuid        PRIMARY KEY REFERENCES platform.deportistas(id) ON DELETE CASCADE,
  gimnasio_id    uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  contenido      bytea       NOT NULL,
  media_type     text        NOT NULL CHECK (media_type IN ('image/jpeg','image/png','image/webp')),
  subida_por     uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_deportista_fotos_gym ON platform.deportista_fotos(gimnasio_id);

ALTER TABLE platform.deportista_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.deportista_fotos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.deportista_fotos;
CREATE POLICY tenant_isolation ON platform.deportista_fotos
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.deportista_fotos TO gymos_platform;

COMMIT;
