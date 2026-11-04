import React, { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { formatMinutos, turnosTrabajoService } from '../../api/turnosTrabajo.service';
import { parseApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { formatHora } from '../../utils/formato';
import type { MiTurnoTrabajo as Mio } from '../../types/turnosTrabajo.types';

/** Entrada y salida de la persona, en la barra de módulos. Es aparte de la caja: no toca dinero. */
export const MiTurnoTrabajo: React.FC = () => {
  const { showToast } = useToast();
  const [mio, setMio] = useState<Mio | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setMio(await turnosTrabajoService.mio());
    } catch {
      setMio(null);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!mio) return null;

  const marcar = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      if (mio.abierto) {
        const t = await turnosTrabajoService.salida();
        showToast('success', 'Turno terminado', `Trabajaste ${formatMinutos(t.minutos)}.`);
      } else {
        await turnosTrabajoService.entrada();
        showToast('success', 'Turno iniciado', 'Tu entrada quedó registrada.');
      }
      await cargar();
    } catch (e) {
      showToast('error', 'No se registró', parseApiError(e));
      cargar();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="sidebar-turno">
      <div className="sidebar-turno-texto">
        {mio.abierto ? (
          <>
            <strong>En turno</strong>
            <span>Desde las {formatHora(mio.abierto.entrada_en)}</span>
          </>
        ) : (
          <>
            <strong>Sin turno</strong>
            <span>{mio.minutos_hoy > 0 ? `Hoy: ${formatMinutos(mio.minutos_hoy)}` : 'Marca tu entrada al llegar'}</span>
          </>
        )}
      </div>
      <button
        type="button"
        className={`btn btn-sm ${mio.abierto ? 'btn-outline' : 'btn-primary'}`}
        onClick={marcar}
        disabled={enviando}
      >
        {mio.abierto ? <LogOut size={14} /> : <LogIn size={14} />}
        {mio.abierto ? 'Terminar' : 'Iniciar'}
      </button>
    </div>
  );
};
