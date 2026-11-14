import type { ClienteEvaluado, ResultadoIngreso, ResumenIngresos } from '../types/ingreso.types';
import { invocar } from './tauri';

/** Control de ingreso. Todo se decide y se guarda en la base local; sube solo al servidor. */
export const ingresoService = {
  buscar: (texto: string) => invocar<ClienteEvaluado[]>('buscar_clientes', { texto }),
  porDocumento: (documento: string) => invocar<ResultadoIngreso>('registrar_ingreso', { documento }),
  porCliente: (deportistaId: string) => invocar<ResultadoIngreso>('registrar_ingreso', { deportistaId }),
  cortesia: (motivo: string) => invocar<ResultadoIngreso>('registrar_cortesia', { motivo }),
  deHoy: () => invocar<ResumenIngresos>('ingresos_de_hoy'),
};
