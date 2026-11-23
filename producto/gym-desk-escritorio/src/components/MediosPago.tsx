import React from 'react';
import { Banknote, CreditCard, Shuffle, Smartphone } from 'lucide-react';

function icono(metodo: string) {
  const m = metodo.toLowerCase();
  if (m === 'efectivo') return <Banknote size={22} />;
  if (/(dat[aá]fono|tarjeta|cr[eé]dito|d[eé]bito)/.test(m)) return <CreditCard size={22} />;
  return <Smartphone size={22} />;
}

/** Medio de pago como botones grandes (para el dedo). "Mixto" reparte el cobro entre varios medios. */
export const MediosPago: React.FC<{
  metodos: string[];
  valor: string;
  onCambio: (m: string) => void;
  onMixto?: () => void;
  disabled?: boolean;
}> = ({ metodos, valor, onCambio, onMixto, disabled }) => (
  <div className="gd-medios" role="radiogroup" aria-label="Medio de pago">
    {metodos.map((m) => (
      <button key={m} type="button" role="radio" aria-checked={valor === m} className={valor === m ? 'activo' : ''} disabled={disabled} onClick={() => onCambio(m)}>
        {icono(m)}
        <span>{m}</span>
      </button>
    ))}
    {onMixto && (
      <button type="button" disabled={disabled} onClick={onMixto} title="Repartir entre varios medios">
        <Shuffle size={22} />
        <span>Mixto</span>
      </button>
    )}
  </div>
);
