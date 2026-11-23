-- GymDesk Escritorio · esquema local · salud y contacto de emergencia del cliente (22-nov-2026)
--
-- Para que recepción vea, también sin red, a quién llamar y qué condición médica tiene el cliente.
-- Dato sensible (Ley 1581): va en la base cifrada de la estación.
ALTER TABLE deportistas ADD COLUMN salud TEXT;   -- JSON: grupo_sanguineo, condiciones, contacto_emergencia_*

-- Esta versión necesita la salud de cada cliente: la próxima sincronización vuelve a traer todo.
UPDATE sync_estado SET cursor = NULL WHERE id = 1;
