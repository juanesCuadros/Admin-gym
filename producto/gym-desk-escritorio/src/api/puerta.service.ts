import { invocar } from './tauri';

export interface ConfigPuerta {
  tipo: 'ninguna' | 'shelly' | 'url';
  direccion: string | null;
  segundos: number;
}

export interface EstadoPuerta {
  config: ConfigPuerta;
  tipos: [string, string][];
  puede_configurar: boolean;
}

export const puertaService = {
  estado: () => invocar<EstadoPuerta>('puerta_estado'),
  configurar: (config: ConfigPuerta) => invocar<ConfigPuerta>('puerta_configurar', { config }),
  abrir: (motivo: string) => invocar<void>('puerta_abrir', { motivo }),
};
