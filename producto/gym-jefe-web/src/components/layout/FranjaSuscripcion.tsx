import React from 'react';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { formatFecha } from '../../utils/formato';

/**
 * Estado de la suscripción del gimnasio (§B4, GW-RF-51). Se lee del backend, nunca se calcula aquí.
 * Estados calculados por el Super-Admin: `activa` · `por_vencer` · `en_gracia` · `bloqueado`.
 */
export interface EstadoSuscripcionDto {
  estado: 'activa' | 'por_vencer' | 'en_gracia' | 'bloqueado';
  /** Días que faltan para el corte (por_vencer) o días transcurridos desde el corte (en_gracia). */
  dias: number;
  fecha_corte: string;
}

/**
 * Pendiente de backend: `gym-jefe-api` no expone ningún endpoint con el estado de la suscripción
 * (ni `/my-gym/info` lo incluye). Hasta que exista, la franja no se muestra. Cero datos inventados.
 */
export function useEstadoSuscripcion(): EstadoSuscripcionDto | null {
  return null;
}

export const FranjaSuscripcion: React.FC = () => {
  const s = useEstadoSuscripcion();
  if (!s) return null;

  if (s.estado === 'por_vencer') {
    return (
      <div className="franja-estado franja-warning" role="status">
        <CalendarClock size={16} />
        <span>
          La suscripción del gimnasio vence en {s.dias} {s.dias === 1 ? 'día' : 'días'} ({formatFecha(s.fecha_corte)}).
        </span>
      </div>
    );
  }

  if (s.estado === 'en_gracia') {
    return (
      <div className="franja-estado franja-danger" role="alert">
        <AlertTriangle size={16} />
        <span>
          La suscripción venció el {formatFecha(s.fecha_corte)}. El sistema sigue disponible por pocos días.
        </span>
      </div>
    );
  }

  // `activa` no muestra nada; `bloqueado` lo resuelve el interceptor llevando a /bloqueado.
  return null;
};
