-- GymDesk Escritorio · esquema local · nota opcional en cada cobro (venta o membresía), hasta 300 letras.
-- Viaja al servidor en la misma operación.
ALTER TABLE caja_ventas ADD COLUMN nota TEXT;
ALTER TABLE caja_pagos_membresia ADD COLUMN nota TEXT;
