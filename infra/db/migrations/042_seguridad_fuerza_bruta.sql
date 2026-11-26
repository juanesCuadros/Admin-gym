-- =====================================================================
-- 042 · Protección contra ataques de fuerza bruta (Portal del Deportista)
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platform.intentos_login_deportista (
  id           bigserial PRIMARY KEY,
  gimnasio_id  uuid        REFERENCES platform.tenant(id) ON DELETE CASCADE,
  correo       citext      NOT NULL,
  ip           inet,
  exito        boolean     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_intentos_deportista_correo ON platform.intentos_login_deportista(correo, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_intentos_deportista_gym_correo ON platform.intentos_login_deportista(gimnasio_id, correo, created_at DESC);

-- Función segura para contar intentos fallidos por IP en el portal del deportista
CREATE OR REPLACE FUNCTION platform.intentos_fallidos_ip_deportista(p_ip inet, p_desde timestamptz)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT count(*) FROM platform.intentos_login_deportista i
  WHERE i.ip = p_ip AND i.exito = false AND i.created_at >= p_desde;
$$;

REVOKE ALL ON FUNCTION platform.intentos_fallidos_ip_deportista(inet, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.intentos_fallidos_ip_deportista(inet, timestamptz) TO gymos_platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.intentos_login_deportista TO gymos_platform;
GRANT USAGE, SELECT ON SEQUENCE platform.intentos_login_deportista_id_seq TO gymos_platform;

COMMIT;
