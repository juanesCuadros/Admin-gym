-- GymDesk Escritorio · esquema local · huella (fase 4, E-43)
--
-- El lector se elige en la estación (solo el Jefe). Las plantillas viven en la base cifrada: la
-- comparación ocurre en el equipo, también sin red. Cada plantilla también sube al servidor.
ALTER TABLE estacion ADD COLUMN lector_huella TEXT NOT NULL DEFAULT 'ninguno';

CREATE TABLE huellas (
  deportista_id  TEXT NOT NULL,
  dedo           TEXT NOT NULL,
  formato        TEXT NOT NULL CHECK (formato IN ('ansi378','iso19794','simulado')),
  plantilla      BLOB NOT NULL,
  registrada_en  TEXT NOT NULL,
  operacion_id   TEXT NOT NULL,              -- su operación huella_enrolar en sync_outbox
  PRIMARY KEY (deportista_id, dedo)
);
CREATE INDEX ix_huellas_formato ON huellas(formato);
