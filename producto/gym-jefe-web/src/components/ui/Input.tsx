import React, { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode, useLayoutEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { formatMiles, limpiarMiles } from '../../utils/formato';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Si es true, aplica y muestra el punto separador de miles en tiempo real y entrega dígitos limpios en onChange. */
  moneda?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  moneda = false,
  id,
  className = '',
  type,
  inputMode,
  value,
  onChange,
  onKeyDown,
  ...props
}) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef<number | null>(null);

  const valorMostrado = moneda ? formatMiles(value as string | number | null | undefined) : value;

  useLayoutEffect(() => {
    if (moneda && caretRef.current !== null && inputRef.current && document.activeElement === inputRef.current) {
      const pos = caretRef.current;
      caretRef.current = null;
      inputRef.current.setSelectionRange(pos, pos);
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
    <div className="form-group">
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {leftIcon && (
          <span
            style={{
              position: 'absolute',
              left: 12,
              display: 'flex',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type={moneda ? 'text' : type}
          inputMode={moneda ? 'numeric' : inputMode}
          value={valorMostrado}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`form-input ${className}`}
          style={{
            paddingLeft: leftIcon ? 38 : 14,
            paddingRight: rightIcon ? 38 : 14,
            borderColor: error ? 'var(--danger)' : undefined,
          }}
          {...props}
        />
        {rightIcon && (
          <span
            style={{
              position: 'absolute',
              right: 12,
              display: 'flex',
              color: 'var(--text-muted)',
            }}
          >
            {rightIcon}
          </span>
        )}
      </div>
      {error && <span className="form-error-msg">{error}</span>}
      {!error && hint && <span className="form-hint">{hint}</span>}
    </div>
  );
};

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
  options: Array<{ value: string | number; label: string }>;
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  hint,
  options,
  id,
  className = '',
  ...props
}) => {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={selectId} className="form-label">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`form-select ${className}`}
        style={{ borderColor: error ? 'var(--danger)' : undefined }}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <span className="form-error-msg">{error}</span>}
      {!error && hint && <span className="form-hint">{hint}</span>}
    </div>
  );
};

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: ReactNode;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  hint,
  id,
  className = '',
  rows = 3,
  ...props
}) => {
  const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={textareaId} className="form-label">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        className={`form-textarea ${className}`}
        style={{ borderColor: error ? 'var(--danger)' : undefined }}
        {...props}
      />
      {error && <span className="form-error-msg">{error}</span>}
      {!error && hint && <span className="form-hint">{hint}</span>}
    </div>
  );
};

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onSearch?: (value: string) => void;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  placeholder = 'Buscar...',
  className = '',
  ...props
}) => {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
      <Search
        size={16}
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}
      />
      <input
        type="search"
        placeholder={placeholder}
        className={`form-input ${className}`}
        style={{ paddingLeft: 36 }}
        {...props}
      />
    </div>
  );
};
