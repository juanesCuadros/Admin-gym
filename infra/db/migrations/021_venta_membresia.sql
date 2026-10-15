-- =====================================================================
-- 021 · Venta de membresía en un solo paso (GW-RF-25, decisión del 15-oct)
-- =====================================================================
-- Idempotente.
-- 1. `es_venta` marca el pago que acompaña la venta de un plan (asignar, plan grupal o cambio de plan).
--    Ese pago no suma días: la vigencia ya la da la membresía (inicio + duración del plan vendido).
-- 2. Los pagos de renovación guardados con `dias_agregados = 0` sí sumaron la duración del plan; se les
--    pone ese valor para que el recálculo tras una anulación dé el mismo vencimiento que ya tienen.
-- =====================================================================

BEGIN;

ALTER TABLE platform.pagos_membresia
  ADD COLUMN IF NOT EXISTS es_venta boolean NOT NULL DEFAULT false;

UPDATE platform.pagos_membresia pm
   SET dias_agregados = COALESCE(m.plan_duracion_dias_vendida, p.duracion_dias)
  FROM platform.membresias m
  JOIN platform.planes p ON p.id = m.plan_id
 WHERE pm.membresia_id = m.id
   AND pm.dias_agregados = 0
   AND pm.es_venta = false;

UPDATE platform.pagos_membresia pm
   SET dias_agregados = p.duracion_dias
  FROM platform.paquetes pq
  JOIN platform.planes p ON p.id = pq.plan_id
 WHERE pm.paquete_id = pq.id
   AND pm.dias_agregados = 0
   AND pm.es_venta = false;

COMMIT;
