import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { rutaHabilitada } from '../../navegacion';

/**
 * Bloquea las rutas de los submódulos apagados con `VITE_MODULOS_ACTIVOS`.
 * Una ruta oculta escrita a mano lleva a Inicio.
 */
export const RutaModuloActivo: React.FC = () => {
  const { pathname } = useLocation();
  if (!rutaHabilitada(pathname)) return <Navigate to="/" replace />;
  return <Outlet />;
};
