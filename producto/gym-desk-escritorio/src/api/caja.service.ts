import type {
  CierreDiario,
  EgresoRegistrado,
  EstadoCaja,
  MovimientoCaja,
  NuevaVenta,
  ProductoVenta,
  ResumenTurno,
  VentaRegistrada,
} from '../types/caja.types';
import { invocar } from './tauri';

/** Caja de la estación. Todo se guarda en la base local, con red o sin ella, y sube solo al servidor. */
export const cajaService = {
  estado: () => invocar<EstadoCaja>('caja_estado'),
  /** Con red consulta al servidor que no haya otro turno abierto; sin red abre igual y lo marca. */
  abrirTurno: (baseInicial: number) => invocar<ResumenTurno>('caja_abrir_turno', { baseInicial }),
  cerrarTurno: (efectivoContado: number, nota?: string) =>
    invocar<ResumenTurno>('caja_cerrar_turno', { efectivoContado, nota: nota || null }),
  productos: (texto: string) => invocar<ProductoVenta[]>('caja_productos', { texto }),
  vender: (venta: NuevaVenta) => invocar<VentaRegistrada>('caja_registrar_venta', { venta }),
  egreso: (monto: number, motivo: string) => invocar<EgresoRegistrado>('caja_registrar_egreso', { monto, motivo }),
  movimientos: (turnoId?: string) => invocar<MovimientoCaja[]>('caja_movimientos', { turnoId: turnoId ?? null }),
  cierreDiario: (fecha?: string) => invocar<CierreDiario>('caja_cierre_diario', { fecha: fecha ?? null }),
};
