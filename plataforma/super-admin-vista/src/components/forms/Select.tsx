import React, { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  hasError?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, hasError, disabled, style, className = '', ...props }, ref) => {
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
        }}
      >
        <select
          ref={ref}
          disabled={disabled}
          style={{
            width: '100%',
            height: '42px',
            padding: '0 36px 0 14px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 'var(--font-size-md)',
            color: 'var(--color-text-primary)',
            colorScheme: 'inherit',
            appearance: 'none',
            WebkitAppearance: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            ...style,
          }}
          className={`select-apple ${className}`}
          {...props}
        >
          {placeholder && (
            <option
              value=""
              disabled
              style={{
                backgroundColor: 'var(--color-bg-card)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              style={{
                backgroundColor: 'var(--color-bg-card)',
                color: 'var(--color-text-primary)',
              }}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <div
          style={{
            position: 'absolute',
            right: '12px',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <ChevronDown size={16} />
        </div>
      </div>
    );
  }
);

Select.displayName = 'Select';
