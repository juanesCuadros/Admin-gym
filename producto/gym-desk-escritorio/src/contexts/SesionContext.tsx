import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { estacionService } from '../api/estacion.service';
import { sesionService } from '../api/sesion.service';
import { aErrorGymDesk, ErrorGymDesk } from '../api/tauri';
import { useInactividad } from '../hooks/useInactividad';
import type { EstadoEstacion } from '../types/estacion.types';
import type { EstadoSesion } from '../types/sesion.types';

interface SesionContextType {
  cargando: boolean;
  /** La base local no abrió o no respondió: la app no puede operar. */
  errorArranque: ErrorGymDesk | null;
  estacion: EstadoEstacion | null;
  sesion: EstadoSesion | null;
  recargar: () => Promise<void>;
  iniciarConPassword: (correo: string, password: string) => Promise<void>;
  iniciarConPin: (staffId: string, pin: string) => Promise<void>;
  desbloquearConPin: (pin: string) => Promise<void>;
  desbloquearConPassword: (password: string) => Promise<void>;
  bloquear: () => Promise<void>;
  cerrar: () => Promise<void>;
  definirPin: (passwordActual: string, pin: string) => Promise<void>;
}

const SesionContext = createContext<SesionContextType | undefined>(undefined);

export const SesionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [cargando, setCargando] = useState(true);
  const [errorArranque, setErrorArranque] = useState<ErrorGymDesk | null>(null);
  const [estacion, setEstacion] = useState<EstadoEstacion | null>(null);
  const [sesion, setSesion] = useState<EstadoSesion | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    setErrorArranque(null);
    try {
      const [est, ses] = await Promise.all([estacionService.estado(), sesionService.estado()]);
      setEstacion(est);
      setSesion(ses);
    } catch (e) {
      setErrorArranque(aErrorGymDesk(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useInactividad({
    activo: sesion?.estado === 'activa',
    avisarActividad: sesionService.registrarActividad,
    consultarEstado: sesionService.estado,
    alCambiar: setSesion,
  });

  const valor = useMemo<SesionContextType>(() => {
    const aplicar = (accion: Promise<EstadoSesion>) => accion.then(setSesion);
    return {
      cargando,
      errorArranque,
      estacion,
      sesion,
      recargar,
      iniciarConPassword: (correo, password) => aplicar(sesionService.iniciarConPassword(correo, password)),
      iniciarConPin: (staffId, pin) => aplicar(sesionService.iniciarConPin(staffId, pin)),
      desbloquearConPin: (pin) => aplicar(sesionService.desbloquearConPin(pin)),
      desbloquearConPassword: (password) => aplicar(sesionService.desbloquearConPassword(password)),
      bloquear: () => aplicar(sesionService.bloquear()),
      cerrar: () => aplicar(sesionService.cerrar()),
      definirPin: (passwordActual, pin) => aplicar(sesionService.definirPin(passwordActual, pin)),
    };
  }, [cargando, errorArranque, estacion, sesion, recargar]);

  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>;
};

export function useSesion(): SesionContextType {
  const ctx = useContext(SesionContext);
  if (!ctx) throw new Error('useSesion debe usarse dentro de SesionProvider');
  return ctx;
}
