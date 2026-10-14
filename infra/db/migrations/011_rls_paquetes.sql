-- =====================================================================
-- 011 · RLS para platform.paquetes (creada en la 010 sin aislamiento)
-- =====================================================================
-- Toda tabla de platform con gimnasio_id lleva la misma política tenant_isolation
-- que 01_schema.sql aplica en bloque. paquetes nació después de ese bloque.
-- Idempotente; integrada en 01_schema.sql.
-- =====================================================================
BEGIN;

ALTER TABLE platform.paquetes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.paquetes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.paquetes;
CREATE POLICY tenant_isolation ON platform.paquetes
  USING (
    gimnasio_id = platform.current_gimnasio_id()
    OR platform.current_gimnasio_id() IS NULL   -- igual que el resto mientras exista la puerta trasera
  )
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

COMMIT;
