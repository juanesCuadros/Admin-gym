import React from 'react';
import { AlertCircle, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import type { EstadoEstacion } from '../types/estacion.types';

const formatoNumero = new Intl.NumberFormat('es-CO');

/**
 * Conexión con el servidor y cuánto falta por subir. Sin red la estación sigue funcionando:
 * lo que se haga queda guardado aquí y sube solo cuando vuelva.
 */
export const IndicadorSync: React.FC<{ estacion: EstadoEstacion; onAbrirPendientes?: () => void }> = ({
  estacion,
  onAbrirPendientes,
}) => {
  const { por_enviar, con_error, por_revisar } = estacion.cola;
  let clase = 'gd-sync-ok';
  let icono = <Cloud size={15} />;
  let texto = 'En línea';
  if (estacion.sincronizando) {
    clase = 'gd-sync-activo';
    icono = <RefreshCw size={15} className="animate-spin" />;
    texto = 'Sincronizando';
  } else if (!estacion.en_linea) {
    clase = 'gd-sync-sin-red';
    icono = <CloudOff size={15} />;
    texto = 'Sin conexión';
  }

  const partes: string[] = [];
  if (por_enviar > 0) partes.push(`${formatoNumero.format(por_enviar)} por subir`);
  if (por_revisar > 0) partes.push(`${formatoNumero.format(por_revisar)} por revisar`);

  const contenido = (
    <>
      <span className={`gd-sync-estado ${clase}`}>
        {icono}
        {texto}
      </span>
      {partes.length > 0 && <span className="gd-sync-detalle">{partes.join(' · ')}</span>}
      {con_error > 0 && (
        <span className="gd-sync-error">
          <AlertCircle size={14} />
          {formatoNumero.format(con_error)} con error
        </span>
      )}
    </>
  );

  return onAbrirPendientes ? (
    <button type="button" className="gd-sync" onClick={onAbrirPendientes} title="Ver lo pendiente de sincronizar">
      {contenido}
    </button>
  ) : (
    <div className="gd-sync" role="status">
      {contenido}
    </div>
  );
};
