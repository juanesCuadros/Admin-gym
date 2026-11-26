-- =====================================================================
-- 041 · Soporte RLS para Portal del Deportista
-- =====================================================================
-- Permite resolver el gimnasio (tenant) a partir del correo del deportista
-- de forma segura (SECURITY DEFINER, retorna únicamente el UUID del gimnasio).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.gimnasio_id_por_correo_deportista(p_correo text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    (SELECT ca.gimnasio_id FROM platform.cuentas_app ca
     JOIN platform.tenant t ON t.id = ca.gimnasio_id
     WHERE lower(ca.correo::text) = lower(p_correo) AND ca.activa = true AND t.activo = true
     ORDER BY ca.updated_at DESC LIMIT 1),
    (SELECT d.gimnasio_id FROM platform.deportistas d
     JOIN platform.tenant t ON t.id = d.gimnasio_id
     WHERE lower(d.correo::text) = lower(p_correo) AND d.deleted_at IS NULL AND d.activo = true AND t.activo = true
     ORDER BY d.created_at DESC LIMIT 1)
  );
$$;

REVOKE ALL ON FUNCTION platform.gimnasio_id_por_correo_deportista(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.gimnasio_id_por_correo_deportista(text) TO gymos_platform;

COMMIT;

