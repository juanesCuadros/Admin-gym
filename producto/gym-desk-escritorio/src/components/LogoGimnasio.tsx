import React, { useState } from 'react';
import { Dumbbell } from 'lucide-react';

/** Logo público del gimnasio (el que sube el Jefe en Configuración de la web). Sin internet o sin logo: la pesa. */
export const LogoGimnasio: React.FC<{ subdominio: string | null | undefined; tam: number; className?: string }> = ({ subdominio, tam, className }) => {
  const [fallo, setFallo] = useState(false);
  if (!subdominio || fallo) return <Dumbbell size={Math.round(tam * 0.6)} className={className} />;
  return (
    <img
      src={`https://${subdominio}.gymdeskcolombia.com/api/v1/my-gym/public-imagen/${subdominio}/logo`}
      alt=""
      className={className}
      style={{ width: tam, height: tam, objectFit: 'contain' }}
      onError={() => setFallo(true)}
    />
  );
};
