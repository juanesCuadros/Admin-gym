import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EstadoSuscripcion } from '../types/estacion.types';

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * Aviso de P-01, igual que en la web: contador desde 5 días antes del corte y aviso durante los
 * 3 días de gracia. Lo calcula la estación con la fecha de corte descargada.
 */
export const FranjaSuscripcion: React.FC<{ suscripcion: EstadoSuscripcion }> = ({ suscripcion }) => {
  const dias = suscripcion.dias_restantes;
  if (dias === null) return null;

  if (suscripcion.estado === 'por_vencer') {
    return (
      <div className="gd-franja gd-franja-aviso" role="status">
        <AlertTriangle size={16} />
        {dias === 0 ? 'El servicio de GymDesk vence hoy.' : `El servicio de GymDesk vence en ${plural(dias, 'día', 'días')}.`}
      </div>
    );
  }
  if (suscripcion.estado === 'en_gracia') {
    const quedan = 3 + dias; // dias es negativo: -1, -2 o -3
    return (
      <div className="gd-franja gd-franja-urgente" role="alert">
        <AlertTriangle size={16} />
        El servicio de GymDesk venció hace {plural(-dias, 'día', 'días')}.{' '}
        {quedan > 0 ? `Se bloquea en ${plural(quedan, 'día', 'días')} si no se registra el pago.` : 'Se bloquea mañana si no se registra el pago.'}
      </div>
    );
  }
  return null;
};
