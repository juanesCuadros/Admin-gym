-- =====================================================================
-- 071 · GymDesk Escritorio: ingresos registrados en la estación
-- =====================================================================
-- Idempotente. Rango 070–079 PENDIENTE DE CONFIRMAR con el equipo.
--
-- TABLAS COMPARTIDAS QUE TOCA:
--   platform.checkins        columnas estacion_id, operacion_id y recibido_en (todas opcionales)
--   platform.congelamientos  columna sync_xid + disparadores tg_sync_marca y tg_sync_eliminado
--   platform.ventas          columna sync_xid + disparadores tg_sync_marca y tg_sync_eliminado
-- No cambia ninguna columna existente. Lo que se registra desde la web queda igual que antes.
--
-- También: la revisión de un movimiento sin dinero se cierra con la resolución 'visto'.
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/071_escritorio_ingreso.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ingresos que llegan de una estación
-- ---------------------------------------------------------------------
-- ts_utc sigue siendo la hora del ingreso (la de la estación); recibido_en es cuándo llegó al servidor.
ALTER TABLE platform.checkins
  ADD COLUMN IF NOT EXISTS estacion_id  uuid REFERENCES platform.estaciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operacion_id uuid,
  ADD COLUMN IF NOT EXISTS recibido_en  timestamptz;

-- Un mismo ingreso de la estación no entra dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS ux_checkin_operacion
  ON platform.checkins(gimnasio_id, operacion_id) WHERE operacion_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Marca de sincronización en congelamientos y ventas (igual que la 070)
-- ---------------------------------------------------------------------
-- La estación necesita los congelamientos para la regla de acceso y las ventas con pase de día
-- para dejar entrar a quien lo pagó hoy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['congelamientos','ventas']
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ADD COLUMN IF NOT EXISTS sync_xid bigint', t);
    EXECUTE format('UPDATE platform.%I SET sync_xid = (pg_current_xact_id()::text)::bigint WHERE sync_xid IS NULL', t);
    EXECUTE format('ALTER TABLE platform.%I ALTER COLUMN sync_xid SET DEFAULT (pg_current_xact_id()::text)::bigint', t);
    EXECUTE format('ALTER TABLE platform.%I ALTER COLUMN sync_xid SET NOT NULL', t);
    EXECUTE format('DROP TRIGGER IF EXISTS tg_sync_marca ON platform.%I', t);
    EXECUTE format(
      'CREATE TRIGGER tg_sync_marca BEFORE INSERT OR UPDATE ON platform.%I
         FOR EACH ROW EXECUTE FUNCTION platform.sync_marcar()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON platform.%I(gimnasio_id, sync_xid, id)', 'ix_sync_' || t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS tg_sync_eliminado ON platform.%I', t);
    EXECUTE format(
      'CREATE TRIGGER tg_sync_eliminado AFTER DELETE ON platform.%I
         FOR EACH ROW EXECUTE FUNCTION platform.sync_registrar_eliminado()', t);
  END LOOP;
END $$;

-- Reemplaza la de la 070: ahora incluye las dos tablas nuevas.
CREATE OR REPLACE FUNCTION platform.sync_reiniciar_marcas()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t text; nueva uuid := gen_random_uuid();
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','staff','permisos_rol','planes','productos','deportistas','membresias',
                           'congelamientos','ventas']
  LOOP
    EXECUTE format('UPDATE platform.%I SET sync_xid = sync_xid', t);  -- el disparador pone la marca nueva
  END LOOP;
  DELETE FROM platform.sync_eliminados;
  UPDATE platform.sync_epoca SET epoca = nueva;
  RETURN nueva;
END $$;
REVOKE ALL ON FUNCTION platform.sync_reiniciar_marcas() FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 3. Revisión de movimientos sin dinero
-- ---------------------------------------------------------------------
-- aplicar / ajustar / anular son para dinero (fase 3). Un ingreso solo se da por visto, con nota.
ALTER TABLE platform.sync_revisiones DROP CONSTRAINT IF EXISTS sync_revisiones_resolucion_check;
ALTER TABLE platform.sync_revisiones
  ADD CONSTRAINT sync_revisiones_resolucion_check
  CHECK (resolucion IS NULL OR resolucion IN ('aplicar','ajustar','anular','visto'));
