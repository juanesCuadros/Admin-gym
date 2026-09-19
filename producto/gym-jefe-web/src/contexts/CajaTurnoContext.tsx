import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { cajaService } from '../api/caja.service';
import { TurnoResumenDto } from '../types/caja.types';
import { useAuth } from './AuthContext';
import { ApiError, toApiError } from '../api/client';

/**
 * Estado del turno de caja actual, compartido por el header, la regla
 * "Recepcionista sin turno abierto → /caja" (§C1) y la vista de Caja.
 */
interface CajaTurnoContextType {
  turno: TurnoResumenDto | null;
  /** `true` mientras se consulta por primera vez. */
  cargando: boolean;
  error: ApiError | null;
  turnoAbierto: boolean;
  refrescar: () => Promise<void>;
}

const CajaTurnoContext = createContext<CajaTurnoContextType | undefined>(undefined);

export const CajaTurnoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, hasPermission } = useAuth();
  const [turno, setTurno] = useState<TurnoResumenDto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const puedeVerCaja = !!user && hasPermission('caja', 'leer');

  const refrescar = useCallback(async () => {
    if (!puedeVerCaja) {
      setTurno(null);
      setCargando(false);
      return;
    }
    try {
      const t = await cajaService.getTurnoActual();
      setTurno(t);
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setCargando(false);
    }
  }, [puedeVerCaja]);

  useEffect(() => {
    setCargando(true);
    refrescar();
  }, [refrescar, user?.id]);

  return (
    <CajaTurnoContext.Provider
      value={{
        turno,
        cargando,
        error,
        turnoAbierto: turno?.estado === 'abierto',
        refrescar,
      }}
    >
      {children}
    </CajaTurnoContext.Provider>
  );
};

export const useCajaTurno = () => {
  const ctx = useContext(CajaTurnoContext);
  if (!ctx) throw new Error('useCajaTurno must be used within a CajaTurnoProvider');
  return ctx;
};
