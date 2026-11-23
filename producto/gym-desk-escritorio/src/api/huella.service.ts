import type { ResultadoIngreso } from '../types/ingreso.types';
import { invocar } from './tauri';

export interface EstadoHuella {
  /** ninguno | digitalpersona | simulado */
  lector: string;
  lectores: [string, string][];
  puede_configurar: boolean;
  puede_registrar: boolean;
  muestras_registro: number;
  dedos: string[];
}

/** Huella (fase 4). La captura y la comparación ocurren en este equipo, también sin red. */
export const huellaService = {
  estado: () => invocar<EstadoHuella>('huella_estado'),
  configurar: (lector: string) => invocar<void>('huella_configurar', { lector }),
  /** Espera el dedo (hasta 15 s). `simulada`: el código que se escribe con el lector simulado. */
  capturar: (simulada?: string) => invocar<string>('huella_capturar', { simulada: simulada ?? null }),
  registrar: (deportistaId: string, dedo: string, muestras: string[]) =>
    invocar<{ deportista_id: string; dedo: string; formato: string }>('huella_registrar', { deportistaId, dedo, muestras }),
  dedos: (deportistaId: string) => invocar<string[]>('huella_dedos', { deportistaId }),
  ingresar: (simulada?: string) => invocar<ResultadoIngreso>('ingreso_por_huella', { simulada: simulada ?? null }),
};

export const NOMBRE_DEDO: Record<string, string> = {
  indice_derecho: 'Índice derecho',
  pulgar_derecho: 'Pulgar derecho',
  medio_derecho: 'Medio derecho',
  anular_derecho: 'Anular derecho',
  menique_derecho: 'Meñique derecho',
  indice_izquierdo: 'Índice izquierdo',
  pulgar_izquierdo: 'Pulgar izquierdo',
  medio_izquierdo: 'Medio izquierdo',
  anular_izquierdo: 'Anular izquierdo',
  menique_izquierdo: 'Meñique izquierdo',
};
