import React from 'react';
import { PlugZap } from 'lucide-react';
import { PantallaCentrada } from '../components/Piezas';
import type { EstadoEstacion } from '../types/estacion.types';

/**
 * Estación recién instalada: la base local ya existe pero aún no pertenece a un gimnasio.
 * La activación (subdominio + código de estación) es la fase 1; aquí no se simula nada.
 */
export const EstacionSinActivarPage: React.FC<{ estacion: EstadoEstacion }> = ({ estacion }) => (
  <PantallaCentrada
    titulo="Esta estación aún no está activada"
    subtitulo="GymDesk ya creó su base de datos cifrada en este equipo. Falta conectarla con tu gimnasio."
    pie={`Versión ${estacion.version_app} · Estación ${estacion.estacion_id.slice(0, 8)}`}
  >
    <div className="gd-aviso">
      <PlugZap size={20} style={{ flexShrink: 0 }} />
      <span>
        La activación con el subdominio del gimnasio y el código de estación todavía no está disponible en esta versión.
        Cuando lo esté, aquí podrás conectar la estación y entrar con tu usuario.
      </span>
    </div>
  </PantallaCentrada>
);
