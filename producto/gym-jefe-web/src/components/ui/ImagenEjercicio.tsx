import React, { useState } from 'react';
import { Dumbbell } from 'lucide-react';

interface ImagenEjercicioProps {
  /** `archivo_url` del ejercicio (GIF o imagen). Sin URL o si no carga, se muestra un ícono. */
  url?: string | null;
  nombre: string;
  /** Lado del cuadro en píxeles. */
  tamano?: number;
  /** Ocupa todo el ancho del contenedor (tarjetas del catálogo). */
  bloque?: boolean;
}

const esUrlValida = (url?: string | null): url is string => !!url && /^https?:\/\//i.test(url.trim());

/** Animación o imagen ilustrativa del ejercicio (GW-RF-28/30). */
export const ImagenEjercicio: React.FC<ImagenEjercicioProps> = ({ url, nombre, tamano = 64, bloque = false }) => {
  const [fallo, setFallo] = useState(false);
  const caja: React.CSSProperties = {
    width: bloque ? '100%' : tamano,
    height: bloque ? 160 : tamano,
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-surface-elevated)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  if (!esUrlValida(url) || fallo) {
    return (
      <div style={caja} aria-hidden="true">
        <Dumbbell size={Math.round(tamano / 2.6)} color="var(--text-muted)" />
      </div>
    );
  }

  return (
    <div style={caja}>
      <img
        src={url.trim()}
        alt={`Cómo se hace: ${nombre}`}
        loading="lazy"
        onError={() => setFallo(true)}
        style={{ width: '100%', height: '100%', objectFit: bloque ? 'contain' : 'cover' }}
      />
    </div>
  );
};
