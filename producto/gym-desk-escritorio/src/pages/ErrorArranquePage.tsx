import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import type { ErrorGymDesk } from '../api/tauri';
import { MensajeError, PantallaCentrada } from '../components/Piezas';

/** La base local no abrió. Se muestra el motivo y nunca se crea otra base por encima. */
export const ErrorArranquePage: React.FC<{ error: ErrorGymDesk; onReintentar: () => void }> = ({ error, onReintentar }) => (
  <PantallaCentrada titulo="GymDesk no pudo abrir sus datos" pie={`Código: ${error.codigo}`}>
    <MensajeError>{error.mensaje}</MensajeError>
    <Button variant="outline" onClick={onReintentar} leftIcon={<RefreshCw size={16} />} style={{ marginTop: 16 }}>
      Reintentar
    </Button>
  </PantallaCentrada>
);
