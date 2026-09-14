import React, { forwardRef } from 'react';

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ hasError, leftElement, rightElement, style, disabled, className = '', ...props }, ref) => {
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
          ref={ref}
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
