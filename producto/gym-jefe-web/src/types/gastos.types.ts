export type EsquemaPago = 'fijo' | 'por_clase' | 'comision';

export interface Gasto {
  id: string;
  categoria: string;
  descripcion?: string | null;
  beneficiario_tipo: 'staff' | 'externo';
  beneficiario_staff_id?: string | null;
  beneficiario_nombre: string;
  metodo: 'efectivo' | 'transferencia';
  monto: number | string;
  fecha: string;
  turno_id?: string | null;
  registrado_por_nombre?: string | null;
  created_at: string;
}

export interface ListadoGastos {
  items: Gasto[];
  total: number;
  suma: number | string;
}

export interface RegistrarGastoRequest {
  categoria: string;
  descripcion?: string;
  beneficiario_tipo: 'staff' | 'externo';
  beneficiario_staff_id?: string;
  beneficiario_nombre?: string;
  metodo: 'efectivo' | 'transferencia';
  monto: number;
}

export interface BeneficiarioStaff {
  id: string;
  nombre: string;
  rol: string;
}

export interface ReporteResultado {
  desde: string;
  hasta: string;
  ingresos: number | string;
  gastos: number | string;
  resultado: number | string;
  gastos_por_categoria: Record<string, number | string>;
}

export interface LiquidacionEntrenador {
  staff_id: string;
  nombre: string;
  esquema?: EsquemaPago | null;
  valor?: number | string | null;
  base_comision?: 'membresias_vendidas' | 'clientes_asignados' | null;
  clases_dictadas: number;
  base_calculo: number | string;
  monto_calculado: number | string;
  pagado: number | string;
  saldo: number | string;
}

export interface ConfigPagoEntrenador {
  esquema: EsquemaPago;
  valor: number;
  base_comision: 'membresias_vendidas' | 'clientes_asignados' | null;
}

export interface RegistrarPagoEntrenador {
  desde: string;
  hasta: string;
  monto: number;
  metodo: 'efectivo' | 'transferencia';
}
