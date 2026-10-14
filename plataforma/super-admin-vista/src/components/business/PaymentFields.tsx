import React from 'react';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Calendar, CreditCard, FileText } from 'lucide-react';
import { hoyBogota } from '@/utils/format';

/** Estado del formulario de pago (texto para no perder lo que escribe el usuario). */
export interface PagoForm {
  monto: string;
  meses: string;
  fecha_pago: string;
  metodo: string;
  nota: string;
}

export function pagoFormInicial(monto?: number | null, meses = 1): PagoForm {
  return {
    monto: monto !== null && monto !== undefined && monto > 0 ? String(Math.round(monto)) : '',
    meses: String(meses),
    fecha_pago: hoyBogota(),
    metodo: '',
    nota: '',
  };
}

/**
 * Reglas de SA-RF-16 CA1: monto > 0 (COP entero), meses entero 1–36, fecha ≤ hoy (Bogotá),
 * método en texto libre (2–100). El servidor vuelve a validar.
 */
export function validarPagoForm(form: PagoForm, conMeses = true): Record<string, string> {
  const errs: Record<string, string> = {};
  const monto = Number(form.monto);
  if (form.monto.trim() === '' || !Number.isInteger(monto) || monto <= 0) {
    errs.monto = 'El monto debe ser un valor en pesos mayor a 0, sin decimales.';
  }
  if (conMeses) {
    const meses = Number(form.meses);
    if (!Number.isInteger(meses) || meses < 1 || meses > 36) {
      errs.meses = 'Los meses deben ser un número entero entre 1 y 36.';
    }
  }
  if (!form.fecha_pago) {
    errs.fecha_pago = 'Indica la fecha del pago.';
  } else if (form.fecha_pago > hoyBogota()) {
    errs.fecha_pago = 'La fecha del pago no puede ser posterior a hoy.';
  }
  const metodo = form.metodo.trim();
  if (metodo.length < 2 || metodo.length > 100) {
    errs.metodo = 'Indica el método de pago (entre 2 y 100 caracteres).';
  }
  return errs;
}

export interface PaymentFieldsProps {
  form: PagoForm;
  onChange: (form: PagoForm) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Si es false, los meses no se editan (los fija el plan). */
  conMeses?: boolean;
  /** Texto bajo el campo de meses cuando no se editan. */
  mesesFijosTexto?: string;
}

export const PaymentFields: React.FC<PaymentFieldsProps> = ({
  form,
  onChange,
  errors = {},
  disabled,
  conMeses = true,
  mesesFijosTexto,
}) => {
  const set = (campo: keyof PagoForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [campo]: e.target.value });

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        <FormField label="Monto (COP)" required error={errors.monto}>
          <TextInput
            type="number"
            inputMode="numeric"
            value={form.monto}
            onChange={set('monto')}
            min={1}
            step={1000}
            disabled={disabled}
            hasError={!!errors.monto}
            leftElement={<span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>$</span>}
          />
        </FormField>

        {conMeses ? (
          <FormField label="Meses que cubre" required error={errors.meses}>
            <TextInput
              type="number"
              inputMode="numeric"
              value={form.meses}
              onChange={set('meses')}
              min={1}
              max={36}
              step={1}
              disabled={disabled}
              hasError={!!errors.meses}
            />
          </FormField>
        ) : (
          <FormField label="Meses que cubre" helperText={mesesFijosTexto}>
            <TextInput value={form.meses} disabled />
          </FormField>
        )}

        <FormField label="Fecha del pago" required error={errors.fecha_pago}>
          <TextInput
            type="date"
            value={form.fecha_pago}
            max={hoyBogota()}
            onChange={set('fecha_pago')}
            disabled={disabled}
            hasError={!!errors.fecha_pago}
            leftElement={<Calendar size={15} />}
          />
        </FormField>
      </div>

      <FormField label="Método de pago" required error={errors.metodo} helperText="Texto libre, por ejemplo: Transferencia Bancolombia, Nequi, Efectivo.">
        <TextInput
          value={form.metodo}
          onChange={set('metodo')}
          maxLength={100}
          disabled={disabled}
          hasError={!!errors.metodo}
          leftElement={<CreditCard size={16} />}
        />
      </FormField>

      <FormField label="Nota" optional error={errors.nota}>
        <TextInput
          value={form.nota}
          onChange={set('nota')}
          maxLength={500}
          disabled={disabled}
          placeholder="ej. Comprobante enviado por WhatsApp"
          leftElement={<FileText size={16} />}
        />
      </FormField>
    </div>
  );
};
