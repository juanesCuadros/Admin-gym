import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Smartphone, StickyNote, Wallet } from 'lucide-react';
import { formatCOP } from '@web/utils/formato';

/** Lo que se manda al núcleo: un medio, o el reparto entre varios; el efectivo recibido y la nota. */
export interface PagoElegido {
  metodo?: string;
  pagos?: { metodo: string; monto: number }[];
  valor_recibido?: number;
  nota?: string;
}

const esEfectivo = (m: string) => m.trim().toLowerCase() === 'efectivo';
const entero = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v)) || 0);
const capital = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);

function icono(m: string) {
  const t = m.toLowerCase();
  if (esEfectivo(m)) return <Banknote size={20} />;
  if (t.includes('tarjeta') || t.includes('dat')) return <CreditCard size={20} />;
  if (t.includes('nequi') || t.includes('davi') || t.includes('transf')) return <Smartphone size={20} />;
  return <Wallet size={20} />;
}

/**
 * Estado del pago: cuánto entra por cada medio. El efectivo puede pasar del total (se da cambio); los demás
 * medios no. Se calcula el resultado listo para enviar, o el problema que lo impide.
 */
export function usePago(metodos: string[], total: number, abierto: boolean) {
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [nota, setNota] = useState('');
  useEffect(() => {
    if (abierto) { setMontos({}); setNota(''); }
  }, [abierto]);

  return useMemo(() => {
    const usados = metodos.filter((m) => entero(montos[m] ?? '') > 0);
    const efectivo = usados.filter(esEfectivo).reduce((s, m) => s + entero(montos[m]), 0);
    const otros = usados.filter((m) => !esEfectivo(m)).reduce((s, m) => s + entero(montos[m]), 0);
    const pagado = efectivo + otros;
    const cambio = pagado - total;
    let problema: string | null = null;
    if (usados.length === 0) problema = 'Toca un medio de pago o escribe cuánto paga con cada uno.';
    else if (otros > total) problema = 'Tarjeta, transferencia y demás no pueden pasar del total: solo el efectivo da cambio.';
    else if (pagado < total) problema = `Faltan ${formatCOP(total - pagado)}.`;
    else if (usados.length > 5) problema = 'Se puede repartir entre máximo 5 medios.';
    else if (nota.trim().length > 300) problema = 'La nota no puede pasar de 300 letras.';

    let resultado: PagoElegido | null = null;
    if (!problema) {
      const notaLimpia = nota.trim() || undefined;
      const efectivoCobrado = efectivo - cambio; // lo que queda en caja después de dar el cambio
      const medios = usados
        .map((m) => ({ metodo: m, monto: esEfectivo(m) ? efectivoCobrado : entero(montos[m]) }))
        .filter((x) => x.monto > 0);
      if (medios.length === 1) {
        resultado = { metodo: medios[0].metodo, valor_recibido: efectivo > 0 ? efectivo : undefined, nota: notaLimpia };
      } else {
        resultado = { pagos: medios, valor_recibido: efectivo > 0 ? efectivo : undefined, nota: notaLimpia };
      }
    }

    /** Toca un medio: le pone lo que falta (o todo, si es el único). */
    const completar = (m: string) => {
      const sinEste = usados.filter((x) => x !== m).reduce((s, x) => s + entero(montos[x]), 0);
      const falta = Math.max(0, total - sinEste);
      setMontos((p) => ({ ...p, [m]: falta > 0 ? String(falta) : '' }));
    };
    const cambiar = (m: string, v: string) => setMontos((p) => ({ ...p, [m]: v.replace(/\D/g, '') }));

    return { montos, nota, setNota, completar, cambiar, efectivo, pagado, cambio, problema, resultado };
  }, [metodos, montos, nota, total]);
}

export type EstadoPago = ReturnType<typeof usePago>;

/** Todos los medios del gimnasio con su valor, el resumen (pagado, cambio o lo que falta) y la nota. */
export const PanelPago: React.FC<{ metodos: string[]; total: number; pago: EstadoPago; disabled?: boolean; detalle?: React.ReactNode }> = ({
  metodos, total, pago, disabled, detalle,
}) => {
  const [conNota, setConNota] = useState(false);
  return (
    <div className="gd-pago">
      <div className="gd-pago-total">
        <span>Total a cobrar</span>
        <strong>{formatCOP(total)}</strong>
        {detalle && <small>{detalle}</small>}
      </div>

      <div className="gd-pago-medios">
        {metodos.map((m) => {
          const valor = pago.montos[m] ?? '';
          const activo = entero(valor) > 0;
          return (
            <div key={m} className={`gd-pago-medio ${activo ? 'activo' : ''}`}>
              <button type="button" disabled={disabled} onClick={() => pago.completar(m)} title="Poner lo que falta">
                {icono(m)}
                <span>{capital(m)}</span>
              </button>
              <div className="gd-pago-valor">
                <span>$</span>
                <input inputMode="numeric" aria-label={`Valor en ${m}`} placeholder="0" disabled={disabled}
                  value={valor ? Number(valor).toLocaleString('es-CO') : ''}
                  onChange={(e) => pago.cambiar(m, e.target.value)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="gd-pago-resumen">
        <div><span>Recibido</span><strong>{formatCOP(pago.pagado)}</strong></div>
        {pago.cambio >= 0 ? (
          <div className="cambio"><span>Cambio</span><strong>{formatCOP(pago.cambio)}</strong></div>
        ) : (
          <div className="falta"><span>Falta</span><strong>{formatCOP(-pago.cambio)}</strong></div>
        )}
      </div>

      {conNota || pago.nota ? (
        <label className="gd-pago-nota">
          <span><StickyNote size={14} /> Anotación (opcional)</span>
          <textarea rows={2} maxLength={300} autoFocus={conNota && !pago.nota} disabled={disabled} value={pago.nota}
            placeholder="Ej.: paga el resto mañana · transferencia a nombre de la mamá"
            onChange={(e) => pago.setNota(e.target.value)} />
        </label>
      ) : (
        <button type="button" className="gd-pago-agregar-nota" onClick={() => setConNota(true)} disabled={disabled}>
          <StickyNote size={14} /> Agregar anotación
        </button>
      )}
      {pago.problema && pago.pagado > 0 && <p className="gd-pista">{pago.problema}</p>}
    </div>
  );
};
