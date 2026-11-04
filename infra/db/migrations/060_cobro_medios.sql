-- =====================================================================
-- 060 · Pago mixto: un cobro repartido entre varios medios de pago
-- =====================================================================
-- Idempotente. Una venta o un pago de membresía con tipo_medio = 'mixto' guarda en
-- platform.cobro_medios cuánto entró por cada medio. El arqueo cuenta solo la parte en
-- efectivo y la anulación devuelve a cada medio lo que se pagó con él.
-- Los cobros de un solo medio no cambian.
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/060_cobro_medios.sql
-- =====================================================================

ALTER TABLE platform.ventas DROP CONSTRAINT IF EXISTS ventas_tipo_medio_check;
ALTER TABLE platform.ventas
  ADD CONSTRAINT ventas_tipo_medio_check CHECK (tipo_medio IN ('efectivo','otro','mixto'));

ALTER TABLE platform.pagos_membresia DROP CONSTRAINT IF EXISTS pagos_membresia_tipo_medio_check;
ALTER TABLE platform.pagos_membresia
  ADD CONSTRAINT pagos_membresia_tipo_medio_check CHECK (tipo_medio IN ('efectivo','otro','mixto'));

CREATE TABLE IF NOT EXISTS platform.cobro_medios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid          NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  venta_id           uuid          REFERENCES platform.ventas(id) ON DELETE CASCADE,
  pago_membresia_id  uuid          REFERENCES platform.pagos_membresia(id) ON DELETE CASCADE,
  metodo             text          NOT NULL,
  tipo_medio         text          NOT NULL CHECK (tipo_medio IN ('efectivo','otro')),
  monto              numeric(12,2) NOT NULL CHECK (monto > 0),
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT cobro_medios_un_destino CHECK ((venta_id IS NULL) <> (pago_membresia_id IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_cobro_medios_venta ON platform.cobro_medios(venta_id);
CREATE INDEX IF NOT EXISTS ix_cobro_medios_pago ON platform.cobro_medios(pago_membresia_id);

ALTER TABLE platform.cobro_medios ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.cobro_medios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.cobro_medios;
CREATE POLICY tenant_isolation ON platform.cobro_medios
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.cobro_medios TO gymos_platform;
