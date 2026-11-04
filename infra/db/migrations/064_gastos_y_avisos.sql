-- =====================================================================
-- 064 · Gastos, pago a entrenadores y avisos de vencimiento
-- =====================================================================
-- Idempotente. Decisiones de Juan del 27-oct-2026:
--   · Gastos con categoría, beneficiario (staff o externo) y método (efectivo de la caja del turno
--     o transferencia). Por defecto solo el Jefe; se puede habilitar con el permiso `gastos`.
--   · Pago a entrenadores configurable: fijo, por clase dictada o comisión. Solo lo registra el Jefe.
--   · Avisos de vencimiento: queda marcado a quién se le avisó y cuándo.
-- =====================================================================

CREATE TABLE IF NOT EXISTS platform.gastos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id            uuid          NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  categoria              text          NOT NULL,
  descripcion            text,
  beneficiario_tipo      text          NOT NULL CHECK (beneficiario_tipo IN ('staff','externo')),
  beneficiario_staff_id  uuid          REFERENCES platform.staff(id) ON DELETE SET NULL,
  beneficiario_nombre    text          NOT NULL,
  metodo                 text          NOT NULL CHECK (metodo IN ('efectivo','transferencia')),
  monto                  numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha                  date          NOT NULL,
  turno_id               uuid          REFERENCES platform.turnos_caja(id) ON DELETE RESTRICT,
  egreso_id              uuid          REFERENCES platform.egresos_caja(id) ON DELETE RESTRICT,
  idempotency_key        text          NOT NULL,
  registrado_por         uuid          REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (gimnasio_id, idempotency_key),
  -- El efectivo sale de la caja del turno: siempre deja su egreso.
  CONSTRAINT gasto_efectivo_con_egreso CHECK (metodo <> 'efectivo' OR (turno_id IS NOT NULL AND egreso_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_gastos_gym_fecha ON platform.gastos(gimnasio_id, fecha DESC);

CREATE TABLE IF NOT EXISTS platform.entrenador_pago_config (
  staff_id       uuid PRIMARY KEY REFERENCES platform.staff(id) ON DELETE CASCADE,
  gimnasio_id    uuid          NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  esquema        text          NOT NULL CHECK (esquema IN ('fijo','por_clase','comision')),
  valor          numeric(12,2) NOT NULL CHECK (valor >= 0),
  base_comision  text          CHECK (base_comision IN ('membresias_vendidas','clientes_asignados')),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT entrenador_comision_con_base CHECK (
    (esquema = 'comision' AND base_comision IS NOT NULL AND valor <= 100)
    OR (esquema <> 'comision' AND base_comision IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS platform.pagos_entrenador (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id      uuid          NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  staff_id         uuid          NOT NULL REFERENCES platform.staff(id) ON DELETE RESTRICT,
  periodo_desde    date          NOT NULL,
  periodo_hasta    date          NOT NULL,
  monto_calculado  numeric(12,2) NOT NULL,
  monto_pagado     numeric(12,2) NOT NULL CHECK (monto_pagado > 0),
  gasto_id         uuid          NOT NULL REFERENCES platform.gastos(id) ON DELETE RESTRICT,
  registrado_por   uuid          REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pago_entrenador_periodo CHECK (periodo_hasta >= periodo_desde)
);
CREATE INDEX IF NOT EXISTS ix_pagos_entrenador ON platform.pagos_entrenador(gimnasio_id, staff_id, periodo_desde);

CREATE TABLE IF NOT EXISTS platform.avisos_vencimiento (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gimnasio_id        uuid        NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
  membresia_id       uuid        NOT NULL REFERENCES platform.membresias(id) ON DELETE CASCADE,
  fecha_vencimiento  date        NOT NULL,
  avisado_por        uuid        REFERENCES platform.staff(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_avisos_membresia ON platform.avisos_vencimiento(membresia_id, created_at DESC);

ALTER TABLE platform.gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.gastos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.gastos;
CREATE POLICY tenant_isolation ON platform.gastos
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

ALTER TABLE platform.entrenador_pago_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.entrenador_pago_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.entrenador_pago_config;
CREATE POLICY tenant_isolation ON platform.entrenador_pago_config
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

ALTER TABLE platform.pagos_entrenador ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.pagos_entrenador FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.pagos_entrenador;
CREATE POLICY tenant_isolation ON platform.pagos_entrenador
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

ALTER TABLE platform.avisos_vencimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.avisos_vencimiento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.avisos_vencimiento;
CREATE POLICY tenant_isolation ON platform.avisos_vencimiento
  USING (gimnasio_id = platform.current_gimnasio_id())
  WITH CHECK (gimnasio_id = platform.current_gimnasio_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.gastos, platform.entrenador_pago_config,
  platform.pagos_entrenador, platform.avisos_vencimiento TO gymos_platform;

-- La matriz de permisos de los gimnasios existentes gana la fila `gastos`, cerrada por defecto.
INSERT INTO platform.permisos_rol (gimnasio_id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar)
SELECT DISTINCT p.gimnasio_id, p.rol, 'gastos', false, false, false, false
FROM platform.permisos_rol p
JOIN platform.tenant t ON t.id = p.gimnasio_id
WHERE p.rol IN ('recepcionista','entrenador')
ON CONFLICT (gimnasio_id, rol, submodulo) DO NOTHING;
