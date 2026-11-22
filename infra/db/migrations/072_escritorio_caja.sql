-- =====================================================================
-- 072 · GymDesk Escritorio: caja sin red (fase 3A)
-- =====================================================================
-- Idempotente. Decisión de Juan del 22-nov-2026 (A1): un turno abierto en una estación es de esa
-- estación. Con red, sigue habiendo un solo turno abierto por gimnasio (P-13). Sin red, la estación
-- puede abrir el suyo; si al reconectar ya había otro, se registra igual y queda por revisar.
--
-- TABLAS COMPARTIDAS QUE TOCA:
--   platform.turnos_caja  columna estacion_id (opcional). Los turnos de la web la dejan en NULL.
--                         El índice de turno único pasa a contar solo los de la web; cada estación
--                         tiene a lo sumo uno abierto. La regla "uno por gimnasio con red" la aplica
--                         el código (abrir en la web y consultar desde la estación).
--   platform.productos    se quita CHECK (stock >= 0): lo vendido sin red se registra aunque deje el
--                         stock negativo y queda por revisar (ALCANCE §5.1). La web sigue sin
--                         vender por debajo de cero: lo valida al cobrar.
-- No cambia nada de lo que ya se registró desde la web.
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/072_escritorio_caja.sql
-- =====================================================================

BEGIN;

ALTER TABLE platform.turnos_caja
  ADD COLUMN IF NOT EXISTS estacion_id uuid REFERENCES platform.estaciones(id) ON DELETE SET NULL;

-- Turno único: uno abierto por gimnasio entre los de la web, y uno por estación.
DROP INDEX IF EXISTS platform.ux_turno_abierto_por_gym;
CREATE UNIQUE INDEX IF NOT EXISTS ux_turno_abierto_por_gym
  ON platform.turnos_caja(gimnasio_id) WHERE estado = 'abierto' AND estacion_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_turno_abierto_por_estacion
  ON platform.turnos_caja(estacion_id) WHERE estado = 'abierto' AND estacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_turno_estacion ON platform.turnos_caja(estacion_id, abierto_en DESC)
  WHERE estacion_id IS NOT NULL;

-- Ventas y egresos que llegan de una estación: cuándo llegaron al servidor.
ALTER TABLE platform.ventas       ADD COLUMN IF NOT EXISTS recibida_en timestamptz;
ALTER TABLE platform.egresos_caja ADD COLUMN IF NOT EXISTS recibido_en timestamptz;

ALTER TABLE platform.productos DROP CONSTRAINT IF EXISTS productos_stock_check;

COMMIT;
