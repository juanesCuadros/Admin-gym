import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { formatMiles, limpiarMiles } from '@/utils/format';

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  /** Si es true, aplica y muestra el punto separador de miles en tiempo real y entrega dígitos limpios en onChange. */
  moneda?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ hasError, leftElement, rightElement, moneda = false, style, disabled, className = '', type, inputMode, value, onChange, onKeyDown, ...props }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);
    const caretRef = useRef<number | null>(null);

    const setRef = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    };

    const valorMostrado = moneda ? formatMiles(value as string | number | null | undefined) : value;

    useLayoutEffect(() => {
      if (moneda && caretRef.current !== null && innerRef.current && document.activeElement === innerRef.current) {
        const pos = caretRef.current;
        caretRef.current = null;
        innerRef.current.setSelectionRange(pos, pos);
      }
    }, [moneda, valorMostrado]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (moneda) {
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (start !== null && end !== null && start === end) {
          if (e.key === 'Backspace' && start > 0 && el.value[start - 1] === '.') {
            el.setSelectionRange(Math.max(0, start - 2), start);
          } else if (e.key === 'Delete' && start < el.value.length && el.value[start] === '.') {
            el.setSelectionRange(start, Math.min(el.value.length, start + 2));
          }
        }
      }
      onKeyDown?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!moneda) {
        onChange?.(e);
        return;
      }
      const el = e.currentTarget;
      const raw = el.value;
      const cursor = el.selectionStart ?? raw.length;
      const digitosRaw = raw.replace(/\D/g, '');
      const digitosAntes = raw.slice(0, cursor).replace(/\D/g, '').length;
      const limpio = limpiarMiles(raw);
      const formateado = formatMiles(limpio);
      const cerosQuitados = digitosRaw.length - limpio.length;
      const digitosObjetivo = Math.max(0, digitosAntes - cerosQuitados);

      let pos = 0;
      let contados = 0;
      while (pos < formateado.length && contados < digitosObjetivo) {
        if (/\d/.test(formateado[pos])) contados++;
        pos++;
      }
      caretRef.current = pos;

      const eventoSintetico = {
        ...e,
        target: { ...e.target, value: limpio },
        currentTarget: { ...e.currentTarget, value: limpio },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange?.(eventoSintetico);

      if (el.value !== formateado) {
        el.value = formateado;
        el.setSelectionRange(pos, pos);
      }
    };

    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          backgroundColor: disabled ? 'var(--color-bg-subtle)' : 'var(--color-bg-card)',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${hasError ? 'var(--color-error)' : 'var(--color-border-strong)'}`,
          transition: 'all var(--transition-fast)',
          overflow: 'hidden',
        }}
      >
        {leftElement && (
          <div
            style={{
              paddingLeft: '12px',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {leftElement}
          </div>
        )}

        <input
          ref={setRef}
          type={moneda ? 'text' : type}
          inputMode={moneda ? 'numeric' : inputMode}
          value={valorMostrado}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          style={{
            width: '100%',
            height: '42px',
            padding: leftElement ? '0 12px 0 8px' : '0 14px',
            paddingRight: rightElement ? '8px' : '14px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 'var(--font-size-md)',
            color: 'var(--color-text-primary)',
            ...style,
          }}
          className={`input-apple ${className}`}
          {...props}
        />

        {rightElement && (
          <div
            style={{
              paddingRight: '12px',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {rightElement}
          </div>
        )}
      </div>
    );
  }
);

TextInput.displayName = 'TextInput';
