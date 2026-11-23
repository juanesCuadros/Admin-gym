-- GymDesk Escritorio · esquema local · puerta o torniquete
--
-- La estación abre la puerta (cerradura magnética, portón o torniquete) con un relé en la red del gimnasio,
-- cuando el ingreso queda verde. Solo el Jefe la configura. Sin configurar, no hace nada.
ALTER TABLE estacion ADD COLUMN puerta_tipo TEXT NOT NULL DEFAULT 'ninguna'
  CHECK (puerta_tipo IN ('ninguna','shelly','url'));
ALTER TABLE estacion ADD COLUMN puerta_direccion TEXT;
ALTER TABLE estacion ADD COLUMN puerta_segundos INTEGER NOT NULL DEFAULT 3;
