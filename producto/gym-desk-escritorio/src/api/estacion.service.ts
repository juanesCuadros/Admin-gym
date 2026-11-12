import type { EstadoEstacion } from '../types/estacion.types';
import { invocar } from './tauri';

export const estacionService = {
  estado: () => invocar<EstadoEstacion>('estado_estacion'),
};
