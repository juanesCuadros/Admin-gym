import type { EstadoEstacion, PaginaCola } from '../types/estacion.types';
import { invocar } from './tauri';

export const estacionService = {
  estado: () => invocar<EstadoEstacion>('estado_estacion'),
  activar: (subdominio: string, codigo: string) => invocar<void>('activar_estacion', { subdominio, codigo }),
  sincronizarAhora: () => invocar<void>('sincronizar_ahora'),
  colaPendientes: (incluirAplicadas: boolean, limite: number, desplazamiento: number) =>
    invocar<PaginaCola>('cola_pendientes', { incluirAplicadas, limite, desplazamiento }),
  reintentarOperacion: (id: string) => invocar<void>('reintentar_operacion', { id }),
};
