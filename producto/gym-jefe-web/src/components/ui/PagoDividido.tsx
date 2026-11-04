import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { Input, Select } from './Input';
import { formatCOP } from '../../utils/formato';
import type { MedioPago } from '../../types/caja.types';

/** Una fila del reparto: el valor se guarda como lo escribe la persona. */
export interface FilaMedio {
  clave: string;
  metodo: string;
  valor: string;
}

const METODOS_SIN_CONFIGURAR = ['Efectivo', 'Otro medio'];

export function tipoMedioDe(metodo: string): 'efectivo' | 'otro' {
  return metodo.trim().toLowerCase() === 'efectivo' ? 'efectivo' : 'otro';
}

function valorDe(fila: FilaMedio): number {
  const n = Number(fila.valor);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function filasIniciales(metodos: string[] | null): FilaMedio[] {
  const lista = metodos?.length ? metodos : METODOS_SIN_CONFIGURAR;
  const efectivo = lista.find((m) => tipoMedioDe(m) === 'efectivo');
  const otro = lista.find((m) => m !== efectivo);
  return [
    { clave: crypto.randomUUID(), metodo: efectivo ?? lista[0], valor: '' },
    { clave: crypto.randomUUID(), metodo: otro ?? lista[0], valor: '' },
  ];
}

export const sumaFilas = (filas: FilaMedio[]) => filas.reduce((acc, f) => acc + valorDe(f), 0);

export const efectivoDeFilas = (filas: FilaMedio[]) =>
  filas.filter((f) => tipoMedioDe(f.metodo) === 'efectivo').reduce((acc, f) => acc + valorDe(f), 0);

/** El reparto se puede cobrar si tiene dos partes con valor y suma exactamente el total. */
export const repartoCompleto = (filas: FilaMedio[], total: number) =>
  filas.filter((f) => valorDe(f) > 0).length >= 2 && sumaFilas(filas) === total;

export const mediosDeFilas = (filas: FilaMedio[]): MedioPago[] =>
  filas
    .filter((f) => valorDe(f) > 0)
    .map((f) => ({ metodo: f.metodo.trim(), tipo_medio: tipoMedioDe(f.metodo), monto: valorDe(f) }));

interface PagoDivididoProps {
  metodos: string[] | null;
  total: number;
  filas: FilaMedio[];
  onChange: (filas: FilaMedio[]) => void;
  disabled?: boolean;
}

/** Reparte el total entre varios medios de pago. Solo deja cobrar cuando la suma es exacta. */
export const PagoDividido: React.FC<PagoDivididoProps> = ({ metodos, total, filas, onChange, disabled }) => {
  const lista = metodos?.length ? metodos : METODOS_SIN_CONFIGURAR;
  const opciones = lista.map((m) => ({ value: m, label: m }));
  const diferencia = total - sumaFilas(filas);

  const cambiar = (clave: string, cambios: Partial<FilaMedio>) =>
    onChange(filas.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)));

  return (
    <div>
      <span className="form-label">Reparto del pago</span>
      {filas.map((f) => (
        <div
          key={f.clave}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 36px', gap: 8, alignItems: 'start' }}
        >
          <Select
            aria-label="Método de pago"
            value={f.metodo}
            disabled={disabled}
            onChange={(e) => cambiar(f.clave, { metodo: e.target.value })}
            options={opciones}
          />
          <Input
            aria-label={`Valor en ${f.metodo}`}
            moneda
            value={f.valor}
            disabled={disabled}
            onChange={(e) => cambiar(f.clave, { valor: e.target.value })}
          />
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Quitar este medio"
            disabled={disabled || filas.length <= 2}
            onClick={() => onChange(filas.filter((x) => x.clave !== f.clave))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Plus size={14} />}
          disabled={disabled}
          onClick={() => onChange([...filas, { clave: crypto.randomUUID(), metodo: lista[0], valor: '' }])}
        >
          Agregar otro medio
        </Button>
        <span
          style={{
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            color: diferencia === 0 ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {diferencia === 0
            ? 'La suma coincide con el total'
            : diferencia > 0
              ? `Faltan ${formatCOP(diferencia)}`
              : `Sobran ${formatCOP(-diferencia)}`}
        </span>
      </div>
    </div>
  );
};
