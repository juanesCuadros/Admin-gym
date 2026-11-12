import { invoke } from '@tauri-apps/api/core';

/** Error con la misma forma que usa la API: `{codigo, mensaje, detalles?}`. */
export class ErrorGymDesk extends Error {
  codigo: string;
  /** Texto para mostrar al usuario. */
  mensaje: string;
  detalles?: Record<string, unknown>;

  constructor(codigo: string, mensaje: string, detalles?: Record<string, unknown>) {
    super(mensaje);
    this.name = 'ErrorGymDesk';
    this.codigo = codigo;
    this.mensaje = mensaje;
    this.detalles = detalles;
  }
}

export function aErrorGymDesk(e: unknown): ErrorGymDesk {
  if (e instanceof ErrorGymDesk) return e;
  if (e && typeof e === 'object' && 'codigo' in e && 'mensaje' in e) {
    const { codigo, mensaje, detalles } = e as { codigo: unknown; mensaje: unknown; detalles?: Record<string, unknown> };
    return new ErrorGymDesk(String(codigo), String(mensaje), detalles);
  }
  return new ErrorGymDesk('ERROR_INTERNO', 'GymDesk tuvo un error inesperado. Cierra y vuelve a abrir la aplicación.');
}

/** Única puerta hacia los comandos de Rust. Solo se usa desde `src/api/*.service.ts`. */
export async function invocar<T>(comando: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(comando, args);
  } catch (e) {
    throw aErrorGymDesk(e);
  }
}
