import React from 'react';
import { EnConstruccion } from '../../components/estados/Estados';

/** Fabrica una página "en construcción" para rutas del menú que aún no tienen pantalla (§B2). */
export function enConstruccion(titulo: string, descripcion?: string): React.FC {
  const Pagina: React.FC = () => <EnConstruccion titulo={titulo} descripcion={descripcion} />;
  Pagina.displayName = `EnConstruccion(${titulo})`;
  return Pagina;
}
