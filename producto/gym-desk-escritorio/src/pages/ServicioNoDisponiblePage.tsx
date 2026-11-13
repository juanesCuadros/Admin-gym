import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { MensajeError, PantallaCentrada } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { EstadoEstacion } from '../types/estacion.types';

const MOTIVO: Record<string, string> = {
  falta_pago: 'El pago del servicio está vencido.',
  prueba_vencida: 'El periodo de prueba terminó.',
  suspendido: 'El servicio fue suspendido.',
  cancelado: 'El servicio fue cancelado.',
};

/**
 * Gimnasio bloqueado (GW-RF-51 CA3) o estación revocada: nadie opera. Lo que ya se registró en esta
 * estación no se pierde y se sigue enviando al servidor.
 */
export const ServicioNoDisponiblePage: React.FC<{ estacion: EstadoEstacion }> = ({ estacion }) => {
  const { sincronizarAhora } = useSesion();
  const { enviando, error, enviar } = useEnvio();

  if (estacion.revocada) {
    return (
      <PantallaCentrada
        titulo="Esta estación fue revocada"
        subtitulo={`El Jefe de ${estacion.gimnasio_nombre ?? 'tu gimnasio'} retiró el acceso de este equipo.`}
        pie={`Versión ${estacion.version_app} · Estación ${estacion.estacion_nombre ?? estacion.estacion_id.slice(0, 8)}`}
      >
        <MensajeError>
          Ya no sincroniza ni se puede usar. Para volver a usar este equipo, pide al Jefe que cree una estación nueva y
          contacta a soporte para reinstalar GymDesk.
        </MensajeError>
      </PantallaCentrada>
    );
  }

  const motivo = estacion.suscripcion.motivo_bloqueo;
  return (
    <PantallaCentrada
      titulo="Servicio bloqueado"
      subtitulo={estacion.gimnasio_nombre ?? undefined}
      pie={`Versión ${estacion.version_app}`}
    >
      <MensajeError>
        {(motivo && MOTIVO[motivo]) ?? 'El servicio del gimnasio no está disponible.'} Comunícate con MVC para reactivarlo.
        Lo que ya registraste en esta estación está guardado.
      </MensajeError>
      {error && <MensajeError>{error}</MensajeError>}
      <Button
        variant="outline"
        isLoading={enviando || estacion.sincronizando}
        leftIcon={<RefreshCw size={16} />}
        style={{ marginTop: 16 }}
        onClick={() => void enviar(sincronizarAhora)}
      >
        Ya pagué: volver a comprobar
      </Button>
    </PantallaCentrada>
  );
};
