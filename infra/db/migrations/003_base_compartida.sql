-- =====================================================================
-- 003 · Base compartida para los carriles de desarrollo paralelo
-- =====================================================================
-- Lo que más de un carril necesita y nadie debe crear por su cuenta:
--   1. Parámetros del gimnasio que faltaban (GW-RF-48): carriles 1 y 2.
--   2. Catálogo de planes de suscripción del SaaS (SA-RF-33): carriles 2 y 3.
--   3. Solicitudes de cambio de plan desde el gimnasio: carriles 2 y 3.
--   4. Funciones puente platform → superadmin para lo anterior.
-- Contrato completo en docs/CONTRATOS-API.md. Idempotente. Lo mismo está
-- integrado en 01_schema.sql para instalaciones nuevas.
--
--   docker exec -i gymos-dev-db-1 psql -U postgres -d gymos_db < infra/db/migrations/003_base_compartida.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Parámetros del gimnasio (GW-RF-48)
-- ---------------------------------------------------------------------
ALTER TABLE platform.tenant
  ADD COLUMN IF NOT EXISTS minimo_dias_congelamiento     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS permitir_descuentos           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tope_descuento_pct            integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ventana_reserva_dias          integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS limite_cancelar_reserva_horas integer NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_parametros_rango') THEN
    ALTER TABLE platform.tenant ADD CONSTRAINT tenant_parametros_rango CHECK (
      minimo_dias_congelamiento >= 1
      AND tope_dias_congelamiento >= minimo_dias_congelamiento
      AND tope_descuento_pct BETWEEN 0 AND 100
      AND ventana_reserva_dias >= 0
      AND limite_cancelar_reserva_horas >= 0
    );
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 2. Planes de suscripción del SaaS (SA-RF-33)
-- ---------------------------------------------------------------------
-- tipo 'prueba': gratis, dura dias_prueba días. tipo 'pago': dura duracion_meses meses.
-- Límites NULL = sin límite. publico = visible para registro autónomo y cambio de plan.
CREATE TABLE IF NOT EXISTS superadmin.planes_suscripcion (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                text        NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre                text        NOT NULL,
  descripcion           text,
  tipo                  text        NOT NULL CHECK (tipo IN ('prueba','pago')),
  precio                numeric(12,0) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  duracion_meses        integer     CHECK (duracion_meses IS NULL OR duracion_meses >= 1),
  dias_prueba           integer     CHECK (dias_prueba IS NULL OR dias_prueba >= 1),
  max_clientes_activos  integer     CHECK (max_clientes_activos IS NULL OR max_clientes_activos >= 1),
  max_staff             integer     CHECK (max_staff IS NULL OR max_staff >= 1),
  activo                boolean     NOT NULL DEFAULT true,
  publico               boolean     NOT NULL DEFAULT true,
  orden                 integer     NOT NULL DEFAULT 0,
  version               integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_tipo_coherente CHECK (
    (tipo = 'prueba' AND dias_prueba IS NOT NULL AND duracion_meses IS NULL AND precio = 0)
    OR (tipo = 'pago' AND duracion_meses IS NOT NULL AND dias_prueba IS NULL)
  )
);

-- Plan con el que se registró cada periodo de suscripción (histórico, SA-RF-14).
ALTER TABLE superadmin.suscripciones
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES superadmin.planes_suscripcion(id) ON DELETE RESTRICT;

-- Planes iniciales. Los precios de mensual y anual los fija MVC en el SA;
-- quedan inactivos hasta entonces (decisión abierta D-2).
INSERT INTO superadmin.planes_suscripcion (codigo, nombre, tipo, precio, dias_prueba, duracion_meses, activo, orden)
VALUES
  ('prueba',  'Prueba gratis', 'prueba', 0, 5,    NULL, true,  0),
  ('mensual', 'Mensual',       'pago',   0, NULL, 1,    false, 1),
  ('anual',   'Anual',         'pago',   0, NULL, 12,   false, 2)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Solicitudes de cambio de plan desde el gimnasio
-- ---------------------------------------------------------------------
-- El Jefe elige un plan en "Mi suscripción"; MVC la aprueba en el SA al registrar el pago manual.
CREATE TABLE IF NOT EXISTS superadmin.solicitudes_plan (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES superadmin.gimnasios(id) ON DELETE CASCADE,
  plan_id            uuid        NOT NULL REFERENCES superadmin.planes_suscripcion(id) ON DELETE RESTRICT,
  estado             text        NOT NULL DEFAULT 'pendiente'
                                 CHECK (estado IN ('pendiente','aprobada','rechazada','cancelada')),
  solicitado_por     text        NOT NULL,   -- nombre del staff (desnormalizado)
  nota               text        CHECK (nota IS NULL OR length(nota) <= 500),
  pago_id            uuid        REFERENCES superadmin.pagos(id) ON DELETE SET NULL,
  motivo_rechazo     text,
  resuelta_por       uuid        REFERENCES superadmin.usuarios_internos(id) ON DELETE SET NULL,
  resuelta_en        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solicitud_resuelta_coherente CHECK (
    (estado = 'pendiente' AND resuelta_en IS NULL)
    OR (estado <> 'pendiente' AND resuelta_en IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_solicitud_pendiente_por_gym
  ON superadmin.solicitudes_plan(gimnasio_id) WHERE estado = 'pendiente';

GRANT SELECT, INSERT, UPDATE, DELETE ON superadmin.planes_suscripcion TO gymos_superadmin;
GRANT SELECT, INSERT, UPDATE, DELETE ON superadmin.solicitudes_plan   TO gymos_superadmin;

-- ---------------------------------------------------------------------
-- 4. Funciones puente para el Sistema Web (gymos_platform no ve superadmin)
-- ---------------------------------------------------------------------

-- Planes que un gimnasio puede elegir (pago, activos y públicos).
CREATE OR REPLACE FUNCTION platform.planes_disponibles()
RETURNS TABLE (
  id uuid, codigo text, nombre text, descripcion text, precio numeric,
  duracion_meses integer, max_clientes_activos integer, max_staff integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT p.id, p.codigo, p.nombre, p.descripcion, p.precio,
         p.duracion_meses, p.max_clientes_activos, p.max_staff
  FROM superadmin.planes_suscripcion p
  WHERE p.tipo = 'pago' AND p.activo AND p.publico
  ORDER BY p.orden, p.precio;
$$;

-- Plan vigente del gimnasio y sus límites (NULL si el gimnasio no tiene plan asignado).
CREATE OR REPLACE FUNCTION platform.plan_actual(p_gimnasio_id uuid)
RETURNS TABLE (
  plan_id uuid, codigo text, nombre text, tipo text,
  max_clientes_activos integer, max_staff integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT p.id, p.codigo, p.nombre, p.tipo, p.max_clientes_activos, p.max_staff
  FROM superadmin.gimnasios gi
  JOIN LATERAL (
    SELECT s.plan_id FROM superadmin.suscripciones s
    WHERE s.gimnasio_id = gi.id
    ORDER BY s.vigente_desde DESC, s.created_at DESC
    LIMIT 1
  ) s ON true
  JOIN superadmin.planes_suscripcion p ON p.id = s.plan_id
  WHERE gi.gimnasio_id = p_gimnasio_id AND gi.deleted_at IS NULL;
$$;

-- Solicitud pendiente del gimnasio, si la hay.
CREATE OR REPLACE FUNCTION platform.solicitud_plan_pendiente(p_gimnasio_id uuid)
RETURNS TABLE (id uuid, plan_id uuid, plan_nombre text, solicitado_por text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT sp.id, sp.plan_id, p.nombre, sp.solicitado_por, sp.created_at
  FROM superadmin.solicitudes_plan sp
  JOIN superadmin.gimnasios gi ON gi.id = sp.gimnasio_id
  JOIN superadmin.planes_suscripcion p ON p.id = sp.plan_id
  WHERE gi.gimnasio_id = p_gimnasio_id AND sp.estado = 'pendiente';
$$;

-- Crea la solicitud. Errores con SQLSTATE propio para que la API los traduzca:
--   P0001 'PLAN_NO_DISPONIBLE' · 23505 (índice ux_solicitud_pendiente_por_gym) = ya hay una pendiente.
CREATE OR REPLACE FUNCTION platform.solicitar_plan(
  p_gimnasio_id uuid, p_plan_id uuid, p_solicitado_por text, p_nota text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_gym uuid;
  v_id  uuid;
BEGIN
  SELECT gi.id INTO v_gym FROM superadmin.gimnasios gi
   WHERE gi.gimnasio_id = p_gimnasio_id AND gi.deleted_at IS NULL AND gi.estado <> 'cancelado';
  IF v_gym IS NULL THEN
    RAISE EXCEPTION 'GIMNASIO_NO_DISPONIBLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM superadmin.planes_suscripcion p
                  WHERE p.id = p_plan_id AND p.tipo = 'pago' AND p.activo AND p.publico) THEN
    RAISE EXCEPTION 'PLAN_NO_DISPONIBLE';
  END IF;
  INSERT INTO superadmin.solicitudes_plan (gimnasio_id, plan_id, solicitado_por, nota)
  VALUES (v_gym, p_plan_id, p_solicitado_por, p_nota)
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

-- El Jefe cancela su propia solicitud pendiente.
CREATE OR REPLACE FUNCTION platform.cancelar_solicitud_plan(p_gimnasio_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH upd AS (
    UPDATE superadmin.solicitudes_plan sp
       SET estado = 'cancelada', resuelta_en = now()
      FROM superadmin.gimnasios gi
     WHERE sp.gimnasio_id = gi.id AND gi.gimnasio_id = p_gimnasio_id AND sp.estado = 'pendiente'
    RETURNING sp.id
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$;

REVOKE ALL ON FUNCTION platform.planes_disponibles()                    FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.plan_actual(uuid)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.solicitud_plan_pendiente(uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.solicitar_plan(uuid, uuid, text, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.cancelar_solicitud_plan(uuid)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.planes_disponibles()                   TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.plan_actual(uuid)                      TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.solicitud_plan_pendiente(uuid)         TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.solicitar_plan(uuid, uuid, text, text) TO gymos_platform;
GRANT EXECUTE ON FUNCTION platform.cancelar_solicitud_plan(uuid)          TO gymos_platform;

COMMIT;
