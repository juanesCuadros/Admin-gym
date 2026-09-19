-- =====================================================================
-- 001 · Tanda 1.5 · Backend de autenticación y estado de suscripción
-- =====================================================================
-- Idempotente: se puede aplicar más de una vez sobre una BD ya creada con
-- 01_schema.sql anterior a esta tanda. Lo mismo ya está integrado en
-- 01_schema.sql para instalaciones nuevas.
--
-- Aplicar como superusuario (postgres):
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_db < infra/db/migrations/001_auth_y_suscripcion.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Rotación de refresh tokens por familia (GW-RF-00.1 CA1, GW-RF-00.3)
-- ---------------------------------------------------------------------
ALTER TABLE platform.sesiones_staff
  ADD COLUMN IF NOT EXISTS familia_id  uuid        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS rotado_en   timestamptz,          -- este refresh ya se usó y fue reemplazado
  ADD COLUMN IF NOT EXISTS revocado_en timestamptz;          -- logout, reuso detectado o cambio de contraseña
CREATE INDEX IF NOT EXISTS ix_ses_familia ON platform.sesiones_staff(familia_id);

-- ---------------------------------------------------------------------
-- 2. Contraseña temporal del staff (GW-RF-00.1 CA3, GW-RF-00.5 CA1)
-- ---------------------------------------------------------------------
ALTER TABLE platform.staff
  ADD COLUMN IF NOT EXISTS debe_cambiar_password       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_temporal_expira_en timestamptz;

-- ---------------------------------------------------------------------
-- 3. Parámetros del tenant: duración de sesión (GW-RF-48) e identidad visual
-- ---------------------------------------------------------------------
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS duracion_sesion_minutos integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS branding                jsonb   NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_duracion_sesion_rango') THEN
    ALTER TABLE platform.tenant
      ADD CONSTRAINT tenant_duracion_sesion_rango CHECK (duracion_sesion_minutos BETWEEN 15 AND 480);
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 4. Puente controlado platform → superadmin (SECURITY DEFINER)
-- gymos_platform NO tiene permisos sobre el esquema superadmin. Estas funciones
-- exponen únicamente lo que el Sistema Web necesita: el estado calculado de la
-- suscripción (sin montos ni deuda) y el estado de la credencial temporal del Jefe.
-- ---------------------------------------------------------------------

-- Estado calculado de la suscripción (requisitos Super-Admin §2.2, GW-RF-51).
-- d = hoy − fecha_corte:  al_dia d < −5 · por_vencer −5 ≤ d ≤ 0 · en_gracia 1 ≤ d ≤ 3
--                          bloqueado d ≥ 4, o prueba con d ≥ 1, o suspendido/cancelado.
CREATE OR REPLACE FUNCTION platform.estado_suscripcion(p_gimnasio_id uuid)
RETURNS TABLE (
  estado_guardado   text,
  fecha_corte       date,
  dias_restantes    integer,
  estado_calculado  text,
  motivo_bloqueo    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH g AS (
    SELECT gi.estado, gi.fecha_corte,
           (now() AT TIME ZONE COALESCE(t.zona_horaria, 'America/Bogota'))::date AS hoy
    FROM superadmin.gimnasios gi
    LEFT JOIN platform.tenant t ON t.id = gi.gimnasio_id
    WHERE gi.gimnasio_id = p_gimnasio_id AND gi.deleted_at IS NULL
  ),
  d AS (
    SELECT estado, fecha_corte, hoy,
           CASE WHEN fecha_corte IS NULL THEN NULL ELSE (hoy - fecha_corte) END AS d
    FROM g
  )
  SELECT
    estado,
    fecha_corte,
    CASE WHEN d IS NULL THEN NULL ELSE -d END AS dias_restantes,
    CASE
      WHEN estado IN ('suspendido', 'cancelado') THEN 'bloqueado'
      WHEN d IS NULL THEN 'al_dia'
      WHEN estado = 'prueba' AND d >= 1 THEN 'bloqueado'
      WHEN d >= 4 THEN 'bloqueado'
      WHEN d >= 1 THEN 'en_gracia'
      WHEN d >= -5 THEN 'por_vencer'
      ELSE 'al_dia'
    END AS estado_calculado,
    CASE
      WHEN estado = 'cancelado' THEN 'cancelado'
      WHEN estado = 'suspendido' THEN 'suspendido'
      WHEN d IS NULL THEN NULL
      WHEN estado = 'prueba' AND d >= 1 THEN 'prueba_vencida'
      WHEN d >= 4 THEN 'falta_pago'
      ELSE NULL
    END AS motivo_bloqueo
  FROM d;
$$;

-- Credencial temporal del Jefe: la emite el Super-Admin (72 h) y su estado vive allá.
CREATE OR REPLACE FUNCTION platform.credencial_jefe(p_gimnasio_id uuid)
RETURNS TABLE (password_cambiada boolean, expira_en timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT cj.password_cambiada,
         (SELECT e.expira_en
            FROM superadmin.emisiones_credenciales e
           WHERE e.gimnasio_id = gi.id
           ORDER BY e.created_at DESC
           LIMIT 1) AS expira_en
  FROM superadmin.gimnasios gi
  JOIN superadmin.cuentas_jefe cj ON cj.gimnasio_id = gi.id
  WHERE gi.gimnasio_id = p_gimnasio_id AND gi.deleted_at IS NULL;
$$;

-- El Jefe cambió su contraseña temporal: se registra en el Super-Admin.
CREATE OR REPLACE FUNCTION platform.marcar_password_jefe_cambiada(p_gimnasio_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE superadmin.cuentas_jefe cj
     SET password_cambiada = true, updated_at = now()
    FROM superadmin.gimnasios gi
   WHERE cj.gimnasio_id = gi.id AND gi.gimnasio_id = p_gimnasio_id;
$$;

REVOKE ALL ON FUNCTION platform.estado_suscripcion(uuid)             FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.credencial_jefe(uuid)                FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.marcar_password_jefe_cambiada(uuid)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.estado_suscripcion(uuid)            TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.credencial_jefe(uuid)               TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.marcar_password_jefe_cambiada(uuid) TO gymos_platform;

COMMIT;
