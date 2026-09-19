import React from 'react';
import { Badge } from './Badge';
import { formatDiaMes } from '../../utils/formato';
import {
  EstadoDeportista,
  DetalleEstado,
  esEstadoDeportista,
  presentarEstado,
} from '../../utils/estadoDeportista';

interface Props {
  estado: EstadoDeportista | string | null | undefined;
  detalle?: DetalleEstado;
}

/**
 * Badge único para el estado del deportista (§A4).
 * Si el backend manda un valor fuera del enum, se pinta tal cual en gris: es una desalineación a reportar.
 */
export const EstadoDeportistaBadge: React.FC<Props> = ({ estado, detalle }) => {
  if (!estado) return <Badge variant="neutral">—</Badge>;
  if (!esEstadoDeportista(estado)) {
    return (
      <Badge variant="neutral" title="Estado no reconocido por la UI">
        {estado}
      </Badge>
    );
  }
  const { variante, texto } = presentarEstado(estado, detalle, formatDiaMes);
  return (
    <Badge variant={variante} dot>
      {texto}
    </Badge>
  );
};
