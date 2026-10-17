-- =====================================================================
-- 040 · Cerrar la "puerta trasera" de RLS en platform
-- =====================================================================
-- Idempotente. Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d <base> < infra/db/migrations/040_cerrar_puerta_trasera_rls.sql
--
-- Antes: toda política de aislamiento traía `OR platform.current_gimnasio_id() IS NULL`. Una consulta del
-- GW que olvidara fijar app.gimnasio_id veía las filas de TODOS los gimnasios.
-- Ahora: sin gimnasio fijado no se ve ni se escribe nada (fail-closed).
--
-- Lo que de verdad necesita leer sin gimnasio fijado pasa por funciones SECURITY DEFINER acotadas:
-- reciben el dato que el usuario ya tiene (subdominio, hash de un token, IP) y devuelven SOLO el id del
-- gimnasio o un conteo; nunca listas ni filas de otros gimnasios. El código fija app.gimnasio_id con ese id
-- y sigue con su consulta normal, ya filtrada por RLS.
-- El Super-Admin (rol gymos_superadmin) escribe en platform.tenant al crear o cambiar de estado un
-- gimnasio: recibe una política propia, igual a las que ya tiene en staff y ejercicios.
-- =====================================================================

BEGIN;

-- 1. Aislamiento estricto en todas las tablas con tenant_isolation -----------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'platform' AND policyname = 'tenant_isolation'
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON platform.%I', t.tablename);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON platform.%I
      USING (gimnasio_id = platform.current_gimnasio_id())
      WITH CHECK (gimnasio_id = platform.current_gimnasio_id())
    $f$, t.tablename);
  END LOOP;
END $$;

-- 2. platform.tenant: cada gimnasio solo se ve a sí mismo ---------------------------------------------
DROP POLICY IF EXISTS tenant_self ON platform.tenant;
CREATE POLICY tenant_self ON platform.tenant
  USING (id = platform.current_gimnasio_id())
  WITH CHECK (id = platform.current_gimnasio_id());

-- El Super-Admin crea gimnasios y cambia su estado (activo) en platform.tenant.
DROP POLICY IF EXISTS superadmin_tenant ON platform.tenant;
CREATE POLICY superadmin_tenant ON platform.tenant
  FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true);

-- 3. platform.ejercicios: el catálogo global sigue visible para todos los gimnasios -----------------
--    (el Super-Admin lo administra con su propia política superadmin_catalogo).
DROP POLICY IF EXISTS ejercicios_global_y_propios ON platform.ejercicios;
CREATE POLICY ejercicios_global_y_propios ON platform.ejercicios
  USING (
    gimnasio_id IS NULL                                   -- catálogo global
    OR gimnasio_id = platform.current_gimnasio_id()       -- propios del gimnasio
  )
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

-- 4. Funciones de resolución para las rutas sin sesión del GW ---------------------------------------

-- Login, recuperación de contraseña, branding público y Pantalla TV: el usuario escribe el subdominio.
CREATE OR REPLACE FUNCTION platform.gimnasio_id_por_subdominio(p_subdominio text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT t.id FROM platform.tenant t WHERE t.subdominio = lower(p_subdominio);
$$;

-- Refresh de sesión: el cliente presenta su refresh token (llega aquí ya hasheado).
CREATE OR REPLACE FUNCTION platform.gimnasio_id_por_refresh(p_refresh_hash text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT s.gimnasio_id FROM platform.sesiones_staff s WHERE s.refresh_hash = p_refresh_hash;
$$;

-- Enlace de recuperación de contraseña: el token llega aquí ya hasheado.
CREATE OR REPLACE FUNCTION platform.gimnasio_id_por_token_recuperacion(p_token_hash text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT t.gimnasio_id FROM platform.tokens_recuperacion_staff t WHERE t.token_hash = p_token_hash;
$$;

-- Bloqueo por IP del login (antes de saber el gimnasio): cuenta los fallos de esa IP en todos los
-- gimnasios, que es justo lo que protege contra quien prueba contraseñas gimnasio por gimnasio.
CREATE OR REPLACE FUNCTION platform.intentos_fallidos_ip(p_ip inet, p_desde timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT count(*) FROM platform.intentos_login_staff i
  WHERE i.ip = p_ip AND i.exito = false AND i.created_at >= p_desde;
$$;

REVOKE ALL ON FUNCTION platform.gimnasio_id_por_subdominio(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.gimnasio_id_por_refresh(text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.gimnasio_id_por_token_recuperacion(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.intentos_fallidos_ip(inet, timestamptz)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.gimnasio_id_por_subdominio(text)         TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.gimnasio_id_por_refresh(text)            TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.gimnasio_id_por_token_recuperacion(text) TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.intentos_fallidos_ip(inet, timestamptz)  TO gymos_platform;

COMMIT;
