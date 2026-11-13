import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { MensajeError, PantallaCentrada } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { EstadoEstacion } from '../types/estacion.types';

const formatoNumero = new Intl.NumberFormat('es-CO');

/** Primera descarga tras activar: hasta que termine, la estación no puede operar sin red. */
export const DescargaInicialPage: React.FC<{ estacion: EstadoEstacion }> = ({ estacion }) => {
  const { sincronizarAhora } = useSesion();
  const { enviando, error, enviar } = useEnvio();
  const c = estacion.conteos;
  const detenida = !estacion.sincronizando;
  const lineas: Array<[string, number]> = [
    ['Personal', c.personal],
    ['Clientes', c.deportistas],
    ['Membresías', c.membresias],
    ['Planes', c.planes],
    ['Productos', c.productos],
  ];

  return (
    <PantallaCentrada
      titulo={detenida ? 'La descarga se detuvo' : 'Descargando los datos del gimnasio'}
      subtitulo={
        <>
          <strong>{estacion.gimnasio_nombre}</strong> · estación {estacion.estacion_nombre}. No cierres GymDesk ni apagues
          el internet hasta que termine.
        </>
      }
      pie={`Versión ${estacion.version_app}`}
    >
      <dl className="gd-conteos" aria-live="polite" aria-busy={!detenida}>
        {lineas.map(([nombre, cantidad]) => (
          <div key={nombre}>
            <dt>{nombre}</dt>
            <dd>{formatoNumero.format(cantidad)}</dd>
          </div>
        ))}
      </dl>

      {detenida && (
        <>
          <MensajeError>
            {estacion.error_sync?.mensaje ?? 'No se completó la descarga inicial.'} Lo que ya se descargó se conserva.
          </MensajeError>
          {error && <MensajeError>{error}</MensajeError>}
          <Button
            variant="outline"
            isLoading={enviando}
            leftIcon={<RefreshCw size={16} />}
            style={{ marginTop: 16 }}
            onClick={() => void enviar(sincronizarAhora)}
          >
            Continuar la descarga
          </Button>
        </>
      )}
      {!detenida && <div className="gd-barra-progreso" role="progressbar" aria-label="Descargando" />}
    </PantallaCentrada>
  );
};
