import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { cajaService } from '../api/caja.service';
import { TurnoResumenDto } from '../types/caja.types';
import { useAuth } from './AuthContext';
import { ApiError, toApiError } from '../api/client';

/**
 * Estado del turno de caja del gimnasio (turno único, contrato 1.1), compartido por el header,
 * la regla "Recepcionista sin turno abierto → /caja" (§C1, contrato 2.8) y las vistas de Caja.
 */
interface CajaTurnoContextType {
  /** Turno abierto del gimnasio, sea propio o de otra persona. */
  turno: TurnoResumenDto | null;
  /** `true` mientras se consulta por primera vez. */
  cargando: boolean;
  error: ApiError | null;
  /** Hay un turno abierto en el gimnasio (de quien sea). */
  turnoAbierto: boolean;
  /** El turno abierto es de quien consulta: solo así puede vender, cobrar y registrar egresos. */
  turnoPropio: boolean;
  refrescar: () => Promise<void>;
}

const CajaTurnoContext = createContext<CajaTurnoContextType | undefined>(undefined);

export const CajaTurnoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, hasPermission } = useAuth();
  // Contrato 2.8: si el login o /auth/me dicen que hay que abrir caja, no se espera a consultar el
  // turno para mandar a la recepcionista a /caja; la consulta lo confirma (o lo corrige) después.
  const requiereAbrirCaja = user?.requiere_abrir_caja === true;
  const [turno, setTurno] = useState<TurnoResumenDto | null>(null);
  const [cargando, setCargando] = useState(!requiereAbrirCaja);
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
    setCargando(!requiereAbrirCaja);
    refrescar();
    // Solo al cambiar de usuario: el indicador de /auth/me no debe volver a disparar la consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refrescar, user?.id]);

  const turnoAbierto = turno?.estado === 'abierto';

  return (
    <CajaTurnoContext.Provider
      value={{
        turno,
        cargando,
        error,
        turnoAbierto,
        // Un backend sin `es_propio` (anterior al contrato 1.1) solo devolvía el turno propio.
        turnoPropio: turnoAbierto && turno?.es_propio !== false,
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
