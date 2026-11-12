import { useEffect, useRef } from 'react';
import type { EstadoSesion } from '../types/sesion.types';

/** Como máximo un aviso de actividad cada 10 s: el bloqueo es a los 5 min, no hace falta más. */
export const INTERVALO_AVISO_MS = 10_000;
/** Cada 5 s se pregunta el estado para pintar el bloqueo apenas ocurra. */
export const INTERVALO_CONSULTA_MS = 5_000;

const EVENTOS: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

interface Opciones {
  /** Solo se vigila mientras hay una sesión activa. */
  activo: boolean;
  avisarActividad: () => Promise<EstadoSesion>;
  consultarEstado: () => Promise<EstadoSesion>;
  alCambiar: (estado: EstadoSesion) => void;
}

/**
 * Avisa a la estación que hay alguien usándola y refleja el bloqueo por inactividad.
 * La regla de los 5 minutos la aplica Rust; este hook solo informa y pinta.
 */
export function useInactividad({ activo, avisarActividad, consultarEstado, alCambiar }: Opciones): void {
  const refs = useRef({ avisarActividad, consultarEstado, alCambiar });
  refs.current = { avisarActividad, consultarEstado, alCambiar };

  useEffect(() => {
    if (!activo) return;

    let ultimoAviso = 0;
    let vigente = true;

    const entregar = (promesa: Promise<EstadoSesion>) => {
      promesa.then((estado) => vigente && refs.current.alCambiar(estado)).catch(() => undefined);
    };

    const alActuar = () => {
      const ahora = Date.now();
      if (ahora - ultimoAviso < INTERVALO_AVISO_MS) return;
      ultimoAviso = ahora;
      entregar(refs.current.avisarActividad());
    };

    EVENTOS.forEach((ev) => window.addEventListener(ev, alActuar, { passive: true }));
    const consulta = window.setInterval(() => entregar(refs.current.consultarEstado()), INTERVALO_CONSULTA_MS);

    return () => {
      vigente = false;
      EVENTOS.forEach((ev) => window.removeEventListener(ev, alActuar));
      window.clearInterval(consulta);
    };
  }, [activo]);
}
