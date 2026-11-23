import React from 'react';
import { formatCOP } from '@web/utils/formato';

/** Montos con los que suele pagar la gente: el exacto y los billetes redondos por encima. */
function sugerencias(a: number): number[] {
  const redondos = [10_000, 20_000, 50_000, 100_000].map((b) => Math.ceil(a / b) * b);
  return [a, ...redondos].filter((v, i, l) => v >= a && l.indexOf(v) === i).slice(0, 4);
}

/**
 * Efectivo recibido con botones rápidos (Exacto, $50.000, $100.000…) y el cambio en grande.
 * También se puede escribir el monto.
 */
export const EfectivoRapido: React.FC<{ aCobrar: number; recibido: string; onRecibido: (v: string) => void }> = ({ aCobrar, recibido, onRecibido }) => {
  const valor = recibido.trim() === '' ? null : Math.round(Number(recibido));
  const cambio = valor !== null && Number.isFinite(valor) ? valor - aCobrar : null;
  return (
    <div className="gd-efectivo">
      <div className="gd-efectivo-cabecera">
        <span>Efectivo recibido</span>
        <span className="gd-efectivo-cobrar">a cobrar en efectivo {formatCOP(aCobrar)}</span>
      </div>
      <div className="gd-efectivo-botones">
        {sugerencias(aCobrar).map((v, i) => (
          <button key={v} type="button" className={valor === v ? 'activo' : ''} onClick={() => onRecibido(String(v))}>
            {i === 0 ? 'Exacto' : formatCOP(v)}
          </button>
        ))}
        <input
          inputMode="numeric"
          placeholder="Otro monto"
          value={recibido && !sugerencias(aCobrar).includes(Number(recibido)) ? recibido : ''}
          onChange={(e) => onRecibido(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {cambio !== null && (
        <div className={`gd-efectivo-cambio ${cambio < 0 ? 'falta' : ''}`}>
          <span>{cambio < 0 ? 'Falta' : 'Cambio'}</span>
          <strong>{formatCOP(Math.abs(cambio))}</strong>
        </div>
      )}
    </div>
  );
};
