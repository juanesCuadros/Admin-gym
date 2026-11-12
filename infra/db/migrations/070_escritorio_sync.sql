-- =====================================================================
-- 070 · GymDesk Escritorio: estaciones y sincronización
-- =====================================================================
-- Idempotente. Rango 070–079 PENDIENTE DE CONFIRMAR con el equipo.
--
-- Qué agrega:
--   1. platform.estaciones               estaciones de recepción y su device_token
--   2. platform.sync_intentos_activacion  bloqueo por intentos al activar
--   3. platform.sync_operaciones          lo que cada estación envió (evita duplicados)
--   4. platform.sync_revisiones           lo que quedó "por revisar" (mismo vocabulario de la 061)
--   5. platform.sync_eliminados           borrados físicos que la estación debe conocer
--   6. Marca de sincronización (sync_xid) en tablas compartidas   ← TOCA TABLAS DE OTROS CARRILES
--   7. platform.staff.password_cambiada_en
--
-- TABLAS COMPARTIDAS QUE TOCA (columna sync_xid + disparador tg_sync_marca + disparador
-- tg_sync_eliminado):
--   platform.tenant · platform.staff · platform.permisos_rol · platform.planes ·
--   platform.productos · platform.deportistas · platform.membresias
-- No cambia updated_at ni ninguna columna existente. La marca solo se escribe; nadie más la lee.
--
-- Por qué una marca de transacción y no updated_at: una transacción que confirma tarde queda con
-- una fecha anterior al cursor de la estación y se perdería. Con el id de transacción, el cursor
-- avanza solo hasta la transacción más vieja que sigue abierta (ver app/modules/sync/pull.py).
--
-- DESPUÉS DE RESTAURAR UN RESPALDO EN OTRO SERVIDOR: ejecutar SELECT platform.sync_reiniciar_marcas();
-- (los ids de transacción no se conservan entre servidores).
--
--   docker exec -i <contenedor-db> psql -U postgres -d <base> < infra/db/migrations/070_escritorio_sync.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Estaciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.estaciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  nombre             text        NOT NULL,
  -- Código de activación: un solo uso, vence. Solo se guarda su hash.
  codigo_hash        text,
  codigo_expira_en   timestamptz,
  -- Credencial de la estación. Solo se guarda su hash; no vence, se revoca.
  device_token_hash  text UNIQUE,
  activada_en        timestamptz,
  nombre_equipo      text,
  version_app        text,
  ultima_sync_en     timestamptz,
  revocada_en        timestamptz,
  revocada_por       uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  motivo_revocacion  text,
  creada_por         uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estacion_revocacion_coherente CHECK (
    (revocada_en IS NULL AND motivo_revocacion IS NULL)
    OR (revocada_en IS NOT NULL AND motivo_revocacion IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_estacion_nombre_vigente
  ON platform.estaciones(gimnasio_id, lower(nombre)) WHERE revocada_en IS NULL;
CREATE INDEX IF NOT EXISTS ix_estacion_gym ON platform.estaciones(gimnasio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform.sync_intentos_activacion (
  id           bigserial PRIMARY KEY,
  gimnasio_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  ip           inet,
  exito        boolean     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sync_intentos_gym ON platform.sync_intentos_activacion(gimnasio_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Operaciones recibidas y revisiones
-- ---------------------------------------------------------------------
-- Solo se guardan las operaciones aceptadas. Una operación inválida no deja nada.
CREATE TABLE IF NOT EXISTS platform.sync_operaciones (
  id               bigserial PRIMARY KEY,
  gimnasio_id      uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  estacion_id      uuid        NOT NULL REFERENCES platform.estaciones(id) ON DELETE RESTRICT,
  operacion_id     uuid        NOT NULL,          -- lo genera la estación
  tipo             text        NOT NULL,
  idempotency_key  text        NOT NULL,
  contenido_hash   text        NOT NULL,          -- detecta un id reutilizado con otro contenido
  staff_id         uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  ocurrida_en      timestamptz NOT NULL,          -- hora de la estación
  recibida_en      timestamptz NOT NULL DEFAULT now(),
  resultado        text        NOT NULL CHECK (resultado IN ('aplicada','pendiente_revision')),
  respuesta        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (gimnasio_id, operacion_id),
  UNIQUE (gimnasio_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ix_sync_op_estacion ON platform.sync_operaciones(estacion_id, recibida_en DESC);

-- Mismo vocabulario que la revisión de turnos (061): pendiente_revision → revisado,
-- revisado_por, revisado_en, nota_revision. Aquí se revisa un movimiento, no un turno.
CREATE TABLE IF NOT EXISTS platform.sync_revisiones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id      uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  operacion_id     bigint      NOT NULL REFERENCES platform.sync_operaciones(id) ON DELETE RESTRICT,
  estacion_id      uuid        NOT NULL REFERENCES platform.estaciones(id) ON DELETE RESTRICT,
  entidad          text        NOT NULL,
  entidad_id       text,
  motivo_codigo    text        NOT NULL,
  motivo           text        NOT NULL,
  detalle          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estado_revision  text        NOT NULL DEFAULT 'pendiente_revision'
                               CHECK (estado_revision IN ('pendiente_revision','revisado')),
  resolucion       text        CHECK (resolucion IS NULL OR resolucion IN ('aplicar','ajustar','anular')),
  revisado_por     uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  revisado_en      timestamptz,
  nota_revision    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_revision_coherente CHECK (
    (estado_revision = 'pendiente_revision' AND resolucion IS NULL AND revisado_en IS NULL)
    OR (estado_revision = 'revisado' AND resolucion IS NOT NULL AND revisado_en IS NOT NULL
        AND nota_revision IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_sync_rev_pendientes
  ON platform.sync_revisiones(gimnasio_id, created_at DESC) WHERE estado_revision = 'pendiente_revision';

-- ---------------------------------------------------------------------
-- 3. Borrados físicos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.sync_eliminados (
  id           bigserial PRIMARY KEY,
  gimnasio_id  uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  tabla        text        NOT NULL,
  registro_id  uuid        NOT NULL,
  sync_xid     bigint      NOT NULL DEFAULT (pg_current_xact_id()::text)::bigint,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sync_elim ON platform.sync_eliminados(gimnasio_id, sync_xid, id);

-- ---------------------------------------------------------------------
-- 4. RLS de las tablas nuevas (igual que 01_schema.sql)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estaciones','sync_intentos_activacion','sync_operaciones','sync_revisiones','sync_eliminados']
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON platform.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON platform.%I
         USING (gimnasio_id = platform.current_gimnasio_id())
         WITH CHECK (gimnasio_id = platform.current_gimnasio_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON platform.%I TO gymos_platform', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO gymos_platform;

-- La estación solo trae su token: se resuelve a un gimnasio con una función acotada,
-- igual que el login por subdominio (migración 040).
CREATE OR REPLACE FUNCTION platform.gimnasio_id_por_device_token(p_token_hash text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT e.gimnasio_id FROM platform.estaciones e WHERE e.device_token_hash = p_token_hash;
$$;
REVOKE ALL ON FUNCTION platform.gimnasio_id_por_device_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.gimnasio_id_por_device_token(text) TO gymos_platform;

-- ---------------------------------------------------------------------
-- 5. Marca de sincronización en tablas compartidas
-- ---------------------------------------------------------------------
-- Época: cambia cuando las marcas dejan de ser comparables (restauración en otro servidor).
-- La estación que ve otra época vuelve a descargar todo.
CREATE TABLE IF NOT EXISTS platform.sync_epoca (
  id     boolean PRIMARY KEY DEFAULT true CHECK (id),
  epoca  uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO platform.sync_epoca (id) VALUES (true) ON CONFLICT DO NOTHING;
GRANT SELECT ON platform.sync_epoca TO gymos_platform;

CREATE OR REPLACE FUNCTION platform.sync_marcar()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sync_xid := (pg_current_xact_id()::text)::bigint;
  RETURN NEW;
END $$;

-- Deja constancia de un borrado físico. Si lo que se está borrando es el gimnasio entero
-- (cascada), no hay a quién avisar.
CREATE OR REPLACE FUNCTION platform.sync_registrar_eliminado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform.tenant WHERE id = OLD.gimnasio_id) THEN
    INSERT INTO platform.sync_eliminados (gimnasio_id, tabla, registro_id)
    VALUES (OLD.gimnasio_id, TG_TABLE_NAME, OLD.id);
  END IF;
  RETURN OLD;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','staff','permisos_rol','planes','productos','deportistas','membresias']
  LOOP
    EXECUTE format('ALTER TABLE platform.%I ADD COLUMN IF NOT EXISTS sync_xid bigint', t);
    EXECUTE format('UPDATE platform.%I SET sync_xid = (pg_current_xact_id()::text)::bigint WHERE sync_xid IS NULL', t);
    EXECUTE format('ALTER TABLE platform.%I ALTER COLUMN sync_xid SET NOT NULL', t);
    EXECUTE format('DROP TRIGGER IF EXISTS tg_sync_marca ON platform.%I', t);
    EXECUTE format(
      'CREATE TRIGGER tg_sync_marca BEFORE INSERT OR UPDATE ON platform.%I
         FOR EACH ROW EXECUTE FUNCTION platform.sync_marcar()', t);
    IF t <> 'tenant' THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON platform.%I(gimnasio_id, sync_xid, id)', 'ix_sync_' || t, t);
      EXECUTE format('DROP TRIGGER IF EXISTS tg_sync_eliminado ON platform.%I', t);
      EXECUTE format(
        'CREATE TRIGGER tg_sync_eliminado AFTER DELETE ON platform.%I
           FOR EACH ROW EXECUTE FUNCTION platform.sync_registrar_eliminado()', t);
    END IF;
  END LOOP;
END $$;

-- Para correr después de restaurar un respaldo en otro servidor.
CREATE OR REPLACE FUNCTION platform.sync_reiniciar_marcas()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t text; nueva uuid := gen_random_uuid();
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','staff','permisos_rol','planes','productos','deportistas','membresias']
  LOOP
    EXECUTE format('UPDATE platform.%I SET sync_xid = sync_xid', t);  -- el disparador pone la marca nueva
  END LOOP;
  DELETE FROM platform.sync_eliminados;
  UPDATE platform.sync_epoca SET epoca = nueva;
  RETURN nueva;
END $$;
REVOKE ALL ON FUNCTION platform.sync_reiniciar_marcas() FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 6. Cambio de contraseña visible para la estación
-- ---------------------------------------------------------------------
-- La estación guarda su propio verificador de contraseña. Cuando la contraseña cambia en la web,
-- esta fecha cambia y la estación invalida ese verificador y el PIN de la persona.
ALTER TABLE platform.staff ADD COLUMN IF NOT EXISTS password_cambiada_en timestamptz;

CREATE OR REPLACE FUNCTION platform.staff_marcar_password()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hash_password IS DISTINCT FROM OLD.hash_password THEN
    NEW.password_cambiada_en := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_staff_password_cambiada ON platform.staff;
CREATE TRIGGER tg_staff_password_cambiada BEFORE UPDATE ON platform.staff
  FOR EACH ROW EXECUTE FUNCTION platform.staff_marcar_password();
