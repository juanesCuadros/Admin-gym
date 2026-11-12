import { useCallback, useRef, useState } from 'react';
import { aErrorGymDesk } from '../api/tauri';

/**
 * Envío de formularios sin doble clic: mientras una acción está en curso se
 * ignoran las siguientes, y el error queda como mensaje fijo hasta el próximo intento.
 */
export function useEnvio() {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);

  const enviar = useCallback(async (accion: () => Promise<void>): Promise<boolean> => {
    if (enCurso.current) return false;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    try {
      await accion();
      return true;
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
      return false;
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }, []);

  return { enviando, error, setError, enviar };
}
