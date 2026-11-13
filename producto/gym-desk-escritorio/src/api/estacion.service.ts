import type { EstadoEstacion } from '../types/estacion.types';
import { invocar } from './tauri';

export const estacionService = {
  estado: () => invocar<EstadoEstacion>('estado_estacion'),
  activar: (subdominio: string, codigo: string) => invocar<void>('activar_estacion', { subdominio, codigo }),
  sincronizarAhora: () => invocar<void>('sincronizar_ahora'),
};
