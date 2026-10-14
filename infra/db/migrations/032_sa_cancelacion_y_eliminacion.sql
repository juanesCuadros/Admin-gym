-- =====================================================================
-- 032 · Carril 3 (Super-Admin) · Cancelación con exportación y eliminación definitiva
--       (requisitos SA §2.4, SA-RF-30, SA-RF-31; contrato 3.4)
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres): las funciones SECURITY DEFINER deben
-- quedar con dueño superusuario.
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_c3 < infra/db/migrations/032_sa_cancelacion_y_eliminacion.sql
--
-- POR QUÉ SECURITY DEFINER: el rol gymos_superadmin NO tiene permisos sobre las tablas del tenant
-- (SA-RNF-01, SA-RF-01 CA4). Para exportar los datos del gimnasio al cancelarlo y para borrarlos
-- en la eliminación definitiva se exponen DOS funciones acotadas, con dueño postgres, que solo
-- operan sobre UN gimnasio y solo si su estado guardado lo permite. El SA no gana ningún otro acceso.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Enlaces de exportación (SA-RF-30): ZIP en el servidor propio, enlace de 30 días.
--    El token se guarda como hash SHA-256; el enlace en claro solo sale en la respuesta de cancelar.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS superadmin.exportaciones_gimnasio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id    uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  token_hash     text        NOT NULL UNIQUE,
  ruta_archivo   text        NOT NULL,
  tamano_bytes   bigint      NOT NULL DEFAULT 0 CHECK (tamano_bytes >= 0),
  expira_en      timestamptz NOT NULL,
  eliminado_en   timestamptz,               -- eliminación definitiva: el enlace responde 410
  descargas      integer     NOT NULL DEFAULT 0 CHECK (descargas >= 0),
  creada_por     uuid        REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_vigencia CHECK (expira_en > created_at)
);
CREATE INDEX IF NOT EXISTS ix_export_gym ON superadmin.exportaciones_gimnasio(gimnasio_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON superadmin.exportaciones_gimnasio TO gymos_superadmin;

-- ---------------------------------------------------------------------
-- 2. El subdominio queda libre tras la eliminación definitiva (SA-RF-05 CA5, SA-RF-31 CA3).
--    El registro del gimnasio se conserva (soft delete) porque MVC guarda sus pagos y auditoría;
--    la unicidad pasa a aplicar solo entre gimnasios no eliminados.
-- ---------------------------------------------------------------------
ALTER TABLE superadmin.gimnasios DROP CONSTRAINT IF EXISTS gimnasios_subdominio_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_gym_subdominio_vivo
  ON superadmin.gimnasios(subdominio) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 3. Exportación de datos del tenant (SA-RF-30 CA1)
--    Devuelve {"columnas": [...], "filas": [{...}]} de un conjunto: deportistas, membresias,
--    pagos (pagos_membresia) o asistencia (checkins). Solo para gimnasios CANCELADOS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION superadmin.exportar_datos_tenant(p_gimnasio_id uuid, p_conjunto text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tabla text;
  v_orden text;
  v_columnas jsonb;
  v_filas jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM superadmin.gimnasios g
                  WHERE g.gimnasio_id = p_gimnasio_id AND g.estado = 'cancelado' AND g.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'GIMNASIO_NO_EXPORTABLE' USING ERRCODE = 'P0001';
  END IF;

  CASE p_conjunto
    WHEN 'deportistas' THEN v_tabla := 'deportistas';     v_orden := 'created_at, id';
    WHEN 'membresias'  THEN v_tabla := 'membresias';      v_orden := 'fecha_inicio, id';
    WHEN 'pagos'       THEN v_tabla := 'pagos_membresia'; v_orden := 'created_at, id';
    WHEN 'asistencia'  THEN v_tabla := 'checkins';        v_orden := 'ts_utc, id';
    ELSE RAISE EXCEPTION 'CONJUNTO_DESCONOCIDO: %', p_conjunto USING ERRCODE = 'P0001';
  END CASE;

  SELECT COALESCE(jsonb_agg(a.attname ORDER BY a.attnum), '[]'::jsonb) INTO v_columnas
    FROM pg_attribute a
   WHERE a.attrelid = format('platform.%I', v_tabla)::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY %s), ''[]''::jsonb) FROM platform.%I t WHERE t.gimnasio_id = $1',
    v_orden, v_tabla
  ) INTO v_filas USING p_gimnasio_id;

  RETURN jsonb_build_object('columnas', v_columnas, 'filas', v_filas);
END$$;

-- ---------------------------------------------------------------------
-- 4. Eliminación definitiva de los datos del tenant (SA-RF-31 CA1, CA3)
--    Solo si el gimnasio está cancelado hace 30 días o más (fechas de Bogotá).
--    Borra TODAS las filas de platform con ese gimnasio_id y la fila de platform.tenant.
--    Varias FK internas del tenant son RESTRICT (p. ej. membresias → planes, ventas → turnos_caja),
--    así que un DELETE en cascada desde tenant falla según el orden. Como se borra el tenant
--    completo, se desactivan los disparadores de integridad solo dentro de esta transacción
--    (session_replication_role = replica, local) y se borra tabla por tabla. Recorre el catálogo,
--    así incluye también las tablas que agreguen otras migraciones. Devuelve las filas borradas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION superadmin.eliminar_datos_tenant(p_gimnasio_id uuid)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t record;
  v_n bigint;
  v_total bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM superadmin.gimnasios g
     WHERE g.gimnasio_id = p_gimnasio_id AND g.estado = 'cancelado' AND g.deleted_at IS NULL
       AND g.fecha_cancelacion IS NOT NULL
       AND ((now() AT TIME ZONE 'America/Bogota')::date
            - (g.fecha_cancelacion AT TIME ZONE 'America/Bogota')::date) >= 30
  ) THEN
    RAISE EXCEPTION 'AUN_NO_ELIMINABLE' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('session_replication_role', 'replica', true);
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'platform' AND c.relkind = 'r'
       AND a.attname = 'gimnasio_id' AND NOT a.attisdropped
  LOOP
    EXECUTE format('DELETE FROM platform.%I WHERE gimnasio_id = $1', t.relname) USING p_gimnasio_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  DELETE FROM platform.tenant WHERE id = p_gimnasio_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;
  PERFORM set_config('session_replication_role', 'origin', true);

  RETURN v_total;
END$$;

REVOKE ALL ON FUNCTION superadmin.exportar_datos_tenant(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION superadmin.eliminar_datos_tenant(uuid)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION superadmin.exportar_datos_tenant(uuid, text) TO gymos_superadmin;
GRANT EXECUTE ON FUNCTION superadmin.eliminar_datos_tenant(uuid)       TO gymos_superadmin;

COMMIT;
