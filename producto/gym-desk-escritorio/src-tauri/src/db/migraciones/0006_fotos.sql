-- GymDesk Escritorio · esquema local · foto del cliente (E-41)
--
-- La foto que se toma en esta estación al registrar a un cliente, para mostrarla en el control de
-- ingreso, también sin red. Va en la base cifrada (es un dato personal). Las fotos tomadas en otro lado
-- no se descargan.
CREATE TABLE fotos_clientes (
  deportista_id  TEXT PRIMARY KEY,
  data_url       TEXT NOT NULL,      -- data:image/jpeg;base64,...
  tomada_en      TEXT NOT NULL
);
