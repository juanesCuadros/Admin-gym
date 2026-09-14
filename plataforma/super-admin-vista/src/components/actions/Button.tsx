import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'cancel';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  className = '',
  style,
  ...props
}) => {
  // Styles based on Apple HIG
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: 'var(--color-action)',
          color: '#FFFFFF',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-xs)',
        };
      case 'secondary':
        return {
          backgroundColor: 'var(--color-bg-card)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: 'var(--shadow-xs)',
        };
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          color: 'var(--color-action)',
          border: '1px solid transparent',
        };
      case 'destructive':
        return {
          backgroundColor: 'var(--color-error)',
          color: '#FFFFFF',
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-xs)',
        };
      case 'cancel':
        return {
          backgroundColor: 'var(--color-bg-subtle)',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
        };
      default:
        return {};
    }
  };

  const getSizeStyles = (): React.CSSProperties => {
    switch (size) {
      case 'sm':
        return {
          minHeight: '34px',
          padding: '0 12px',
          fontSize: 'var(--font-size-sm)',
          gap: '6px',
        };
      case 'lg':
        return {
          minHeight: '48px',
          padding: '0 24px',
          fontSize: 'var(--font-size-lg)',
          gap: '10px',
        };
      case 'md':
      default:
        return {
          minHeight: '40px',
          padding: '0 18px',
          fontSize: 'var(--font-size-md)',
          gap: '8px',
        };
    }
  };

  return (
    <button
      disabled={disabled || isLoading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        fontWeight: 'var(--font-weight-medium)',
        cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all var(--transition-fast)',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        width: fullWidth ? '100%' : 'auto',
        ...getVariantStyles(),
        ...getSizeStyles(),
        ...style,
      }}
      className={`btn-apple ${className}`}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 size={16} className="spinner" style={{ marginRight: '6px' }} />
          <span>Procesando…</span>
        </>
      ) : (
        <>
          {leftIcon && <span style={{ display: 'flex', alignItems: 'center' }}>{leftIcon}</span>}
          {children}
          {rightIcon && <span style={{ display: 'flex', alignItems: 'center' }}>{rightIcon}</span>}
        </>
      )}
    </button>
  );
};
